import { loadConfig } from './config/env.js';
import { RedisDispatch } from './persistence/redis-dispatch.js';
import { createRuntimePipeline, type RuntimePipeline } from './runtime.js';
import { runWorker } from './worker/process-receipt.js';
import { bootstrapContactSync, type ContactSyncRuntime } from './contacts/bootstrap-contact-sync.js';
import { describeJamaContactsTarget, jamaContactsPoolOptionsFromConfig } from './contacts/jama-contacts-pool.js';
import { createLogger } from './observability/logger.js';

const logger = createLogger();

type RedisRuntime = Pick<RedisDispatch, 'consume' | 'close'>;
type RunWorker = typeof runWorker;

export async function runWorkerRuntime(
  pipeline: RuntimePipeline,
  redis: RedisRuntime,
  run: RunWorker = runWorker,
): Promise<void> {
  let syncHandle: { stop(): Promise<void>; ready?: Promise<void> } | undefined;
  let contactSyncHandle: { stop(): Promise<void>; ready?: Promise<void> } | undefined;
  let contactSyncRuntime: ContactSyncRuntime | undefined;
  try {
    await pipeline.receiptStore.initialize();
    await pipeline.operationalStore.initialize();
    await pipeline.knowledgeStore.initialize();
    if (pipeline.contactSyncStore) await pipeline.contactSyncStore.initialize();

    if (pipeline.contactSyncStore && pipeline.config.contactSync?.enabled) {
      const poolOptions = jamaContactsPoolOptionsFromConfig(pipeline.config.contactSync);
      const jamaTarget = await describeJamaContactsTarget(poolOptions);
      logger.info(
        {
          ...jamaTarget,
          jamaContactsPasswordConfigured: Boolean(pipeline.config.contactSync.databasePassword),
        },
        `jama contacts postgres target user=${jamaTarget.user ?? 'missing'} host=${jamaTarget.host ?? 'missing'} connectHost=${jamaTarget.connectHost ?? 'same'} passwordConfigured=${Boolean(pipeline.config.contactSync.databasePassword)}`,
      );
      try {
        contactSyncRuntime = await bootstrapContactSync({
          config: pipeline.config,
          chatwoot: pipeline.chatwoot,
          contactSyncStore: pipeline.contactSyncStore,
        });
        contactSyncHandle = contactSyncRuntime.contactSync.start();
        await contactSyncHandle.ready;
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          { component: 'contacts', event: 'initial_sync_failed', errorName, errorMessage },
          `initial contact sync failed: ${errorMessage}`,
        );
      }
    }

    if ((pipeline.config.ai?.knowledgeSource ?? 'local') === 'chatwoot') {
      try {
        syncHandle = pipeline.knowledgeSync.start();
        await syncHandle.ready;
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorCode = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : undefined;
        logger.error({
          component: 'knowledge',
          event: 'initial_sync_failed',
          errorName,
          ...(errorCode ? { errorCode } : {}),
        }, 'initial knowledge sync failed; continuing with fallback');
      }
    }

    await run({ workerId: `worker-${process.pid}` }, {
      store: pipeline.receiptStore,
      dispatch: redis,
      processor: {
        operationalStore: pipeline.operationalStore,
        chatwoot: pipeline.chatwoot,
        senderNumber: pipeline.config.telnyx.senderNumber,
        config: pipeline.config,
        openai: pipeline.openai,
        history: pipeline.history,
        telnyx: pipeline.aiTelnyx,
        knowledge: pipeline.knowledgeProvider,
      },
    });
  } finally {
    await contactSyncHandle?.stop().catch(() => undefined);
    await syncHandle?.stop().catch(() => undefined);
    await contactSyncRuntime?.jamaContactsPool.end().catch(() => undefined);
    await redis.close().catch(() => undefined);
    await pipeline.pool.end().catch(() => undefined);
  }
}

export async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.runtimeRole !== 'worker') throw new Error('Worker service requires RUNTIME_ROLE=worker');
  if (!config.persistence.redisUrl) throw new Error('Worker service requires REDIS_URL');
  const pipeline = createRuntimePipeline(config);
  const redis = new RedisDispatch(config.persistence.redisUrl, config.persistence.redisPrefix);
  await runWorkerRuntime(pipeline, redis);
}

if (process.argv[1]?.endsWith('/worker.js') || process.argv[1]?.endsWith('\\\\worker.js')) {
  main().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : 'StartupError';
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Worker startup failed (${name}): ${message}\n`);
    process.exitCode = 1;
  });
}
