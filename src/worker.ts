import { loadConfig } from './config/env.js';
import { PostgresStore } from './persistence/postgres-store.js';
import { RedisDispatch } from './persistence/redis-dispatch.js';
import { createRuntimePipeline } from './runtime.js';
import { runWorker } from './worker/process-receipt.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.runtimeRole !== 'worker') throw new Error('Worker service requires RUNTIME_ROLE=worker');
  if (config.persistence.mode !== 'postgres_redis' || !config.persistence.databaseUrl || !config.persistence.redisUrl) {
    throw new Error('Worker service requires postgres_redis persistence');
  }

  const pipeline = createRuntimePipeline(config);
  const postgres = new PostgresStore(config.persistence.databaseUrl);
  const redis = new RedisDispatch(config.persistence.redisUrl, config.persistence.redisPrefix);
  try {
    await postgres.initialize();
    await runWorker({ workerId: `worker-${process.pid}` }, {
      store: postgres,
      dispatch: redis,
      processor: {
        // BridgeStore is intentionally used only for the existing inbound/AI
        // operational pipeline; receipt lifecycle remains PostgreSQL-native.
        operationalStore: pipeline.store,
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
    await postgres.close().catch(() => undefined);
    pipeline.store.close();
  }
}

main().catch(() => {
  process.stderr.write('Worker startup failed; check sanitized configuration and service availability.\n');
  process.exitCode = 1;
});
