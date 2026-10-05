import { loadConfig } from './config/env.js';
import { RedisDispatch } from './persistence/redis-dispatch.js';
import { createRuntimePipeline } from './runtime.js';
import { runWorker } from './worker/process-receipt.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.runtimeRole !== 'worker') throw new Error('Worker service requires RUNTIME_ROLE=worker');
  if (!config.persistence.redisUrl) throw new Error('Worker service requires REDIS_URL');
  const pipeline = createRuntimePipeline(config);
  const redis = new RedisDispatch(config.persistence.redisUrl, config.persistence.redisPrefix);
  try {
    await pipeline.receiptStore.initialize();
    await pipeline.operationalStore.initialize();
    await runWorker({ workerId: `worker-${process.pid}` }, {
      store: pipeline.receiptStore,
      dispatch: redis,
      processor: {
        operationalStore: pipeline.operationalStore,
        chatwoot: pipeline.chatwoot,
        senderNumber: config.telnyx.senderNumber,
        config: pipeline.config,
        openai: pipeline.openai,
        history: pipeline.history,
        telnyx: pipeline.aiTelnyx,
      },
    });
  } finally {
    await redis.close().catch(() => undefined);
    await pipeline.pool.end().catch(() => undefined);
  }
}

main().catch(() => {
  process.stderr.write('Worker startup failed; check sanitized configuration and service availability.\n');
  process.exitCode = 1;
});
