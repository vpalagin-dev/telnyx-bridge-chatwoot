import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../../../src/persistence/postgres-store.js';
import {
  RedisDispatch,
  republishUndispatched,
  startOutboxRecoveryLoop,
} from '../../../src/persistence/redis-dispatch.js';

const redisUrl = process.env.TEST_REDIS_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = redisUrl ? describe : describe.skip;

suite('RedisDispatch (disposable TEST_REDIS_URL only)', () => {
  const prefix = `redis-dispatch-test-${randomUUID()}:`;
  let dispatch: RedisDispatch;
  let raw: RedisClientType;

  beforeAll(async () => {
    dispatch = new RedisDispatch(redisUrl!, prefix);
    raw = createClient({ url: redisUrl! });
    await raw.connect();
  });

  afterAll(async () => {
    await dispatch.close();
    await raw.quit();
  });

  it('publishes job IDs on a channel using the configured prefix', async () => {
    const jobId = `job-${randomUUID()}`;
    const received = new Promise<string>((resolve) => {
      void raw.subscribe(`${prefix}${jobId}`, (message) => resolve(message));
    });

    await dispatch.publish({ jobId });

    await expect(received).resolves.toBe(jobId);
    await raw.unsubscribe(`${prefix}${jobId}`);
  });

  it('does not invoke the handler twice for duplicate notifications', async () => {
    const jobId = `job-${randomUUID()}`;
    const handled: string[] = [];
    await dispatch.consume(async (receivedJobId) => {
      handled.push(receivedJobId);
    });

    await raw.publish(`${prefix}${jobId}`, jobId);
    await raw.publish(`${prefix}${jobId}`, jobId);
    await vi.waitFor(() => expect(handled).toEqual([jobId]));

    expect(handled).toHaveLength(1);
  });

  it('removes a job from dedupe after a synchronously throwing handler', async () => {
    const jobId = `job-${randomUUID()}`;
    let attempts = 0;
    await dispatch.consume(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('handler failed');
    });

    await raw.publish(`${prefix}${jobId}`, jobId);
    await vi.waitFor(() => expect(attempts).toBe(1));
    await raw.publish(`${prefix}${jobId}`, jobId);
    await vi.waitFor(() => expect(attempts).toBe(2));
  });

  it('clears dedupe state when an instance is closed and reused', async () => {
    const jobId = `job-${randomUUID()}`;
    const handled: string[] = [];
    await dispatch.consume((receivedJobId) => {
      handled.push(receivedJobId);
    });
    await raw.publish(`${prefix}${jobId}`, jobId);
    await vi.waitFor(() => expect(handled).toEqual([jobId]));
    await dispatch.close();

    await dispatch.consume((receivedJobId) => {
      handled.push(receivedJobId);
    });
    await raw.publish(`${prefix}${jobId}`, jobId);
    await vi.waitFor(() => expect(handled).toEqual([jobId, jobId]));
  });

  it.skipIf(!databaseUrl)('leaves the PostgreSQL outbox row undispatched when Redis publish fails', async () => {
    const store = new PostgresStore(databaseUrl!);
    await store.initialize();
    const inserted = await store.insertReceipt({
      provider: 'test',
      providerEventId: `redis-failure-${randomUUID()}`,
      rawPayload: { test: true },
    });
    const [job] = await store.claimOutboxBatch(1, `test-dispatcher-${randomUUID()}`, 0);
    expect(job?.receiptId).toBe(inserted.receiptId);

    const failed = new RedisDispatch('redis://127.0.0.1:1', prefix);
    await expect(republishUndispatched(store, failed, 'test-recovery', 1, 0)).rejects.toThrow();

    const recovery = await store.claimOutboxBatch(1, `test-recovery-check-${randomUUID()}`, 0);
    expect(recovery.find((candidate) => candidate.jobId === job?.jobId)?.dispatchedAt).toBeNull();
    await store.close();
    await failed.close();
  });
});

describe('RedisDispatch configuration', () => {
  it.each(['unsafe*', 'unsafe?', 'unsafe[', 'unsafe]', 'unsafe\\', 'unsafe space'])('rejects unsafe channel prefix %j', (unsafePrefix) => {
    expect(() => new RedisDispatch('redis://127.0.0.1:6379', unsafePrefix)).toThrow(/prefix/i);
  });

  it('rejects invalid recovery timing and batch options', () => {
    const store = {} as never;
    const dispatch = {} as never;
    for (const options of [
      { batchSize: 0 },
      { batchSize: Number.NaN },
      { batchSize: Infinity },
      { leaseDurationMs: -1 },
      { leaseDurationMs: Number.NaN },
      { intervalMs: 0 },
      { intervalMs: Infinity },
    ]) {
      expect(() => startOutboxRecoveryLoop(store, dispatch, options)).toThrow(/positive|finite|non-negative/i);
    }
  });

  it('contains an onError callback throw inside the recovery loop', async () => {
    const store = {
      claimOutboxBatch: vi.fn().mockRejectedValue(new Error('store unavailable')),
    } as never;
    const dispatch = {} as never;
    const onError = vi.fn(() => {
      throw new Error('error handler failed');
    });
    const loop = startOutboxRecoveryLoop(store, dispatch, { intervalMs: 60_000, onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    await expect(loop.stop()).resolves.toBeUndefined();
  });

  it('contains an async onError callback rejection inside the recovery loop', async () => {
    const store = {
      claimOutboxBatch: vi.fn().mockRejectedValue(new Error('store unavailable')),
    } as never;
    const dispatch = {} as never;
    const onError = vi.fn(async () => {
      throw new Error('async error handler failed');
    });
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const loop = startOutboxRecoveryLoop(store, dispatch, { intervalMs: 60_000, onError });
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      await expect(loop.stop()).resolves.toBeUndefined();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  if (!redisUrl) {
    it.skip('requires TEST_REDIS_URL and never falls back to Railway credentials', () => {
      expect.fail('Set TEST_REDIS_URL to run Redis integration tests');
    });
  }
});

