import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../../../src/persistence/postgres-store.js';
import { RedisDispatch, republishUndispatched } from '../../../src/persistence/redis-dispatch.js';

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

if (!redisUrl) {
  describe('RedisDispatch configuration', () => {
    it.skip('requires TEST_REDIS_URL and never falls back to Railway credentials', () => {
      expect.fail('Set TEST_REDIS_URL to run Redis integration tests');
    });
  });
}

