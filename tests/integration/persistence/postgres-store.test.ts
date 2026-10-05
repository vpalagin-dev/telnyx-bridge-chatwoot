import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../../../src/persistence/postgres-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('PostgresStore (disposable TEST_DATABASE_URL only)', () => {
  let pool: Pool;
  let store: PostgresStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    store = new PostgresStore(databaseUrl!);
    await store.initialize();
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS telnyx_bridge CASCADE');
    await pool.end();
    await store.close();
  });

  it('deduplicates provider events and creates one outbox job', async () => {
    const eventId = `event-${randomUUID()}`;
    const first = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: eventId,
      rawPayload: { data: { id: eventId } },
    });
    const duplicate = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: eventId,
      rawPayload: { duplicate: true },
    });

    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ inserted: false, receiptId: first.receiptId });

    const jobs = await store.claimOutboxBatch(10);
    expect(jobs.filter((job) => job.receiptId === first.receiptId)).toHaveLength(1);
  });

  it('lets exactly one worker atomically claim a pending receipt', async () => {
    const inserted = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `claim-${randomUUID()}`,
      rawPayload: { hello: 'world' },
    });

    const claims = await Promise.all([
      store.claimReceipt(inserted.receiptId, 'worker-a'),
      store.claimReceipt(inserted.receiptId, 'worker-b'),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find((claim) => claim)?.lockedBy).toMatch(/^worker-/);
    expect(await store.claimReceipt(inserted.receiptId, 'worker-c')).toBeNull();
  });

  it('records retry scheduling and allows a later claim', async () => {
    const inserted = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `retry-${randomUUID()}`,
      rawPayload: { retry: true },
    });
    expect(await store.claimReceipt(inserted.receiptId, 'worker')).not.toBeNull();

    const nextAttemptAt = new Date(Date.now() - 1000);
    await store.retryReceipt(inserted.receiptId, new Error('downstream unavailable'), nextAttemptAt);

    const retry = await store.claimReceipt(inserted.receiptId, 'worker-retry');
    expect(retry).toMatchObject({
      receiptId: inserted.receiptId,
      status: 'processing',
      attempts: 1,
      lockedBy: 'worker-retry',
      lastError: 'downstream unavailable',
    });
  });

  it('records completion and review-required outcomes', async () => {
    const completed = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `complete-${randomUUID()}`,
      rawPayload: { complete: true },
    });
    await store.claimReceipt(completed.receiptId, 'worker');
    await store.completeReceipt(completed.receiptId, { outcome: 'processed' });
    expect(await store.claimReceipt(completed.receiptId, 'worker-again')).toBeNull();

    const review = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `review-${randomUUID()}`,
      rawPayload: { review: true },
    });
    await store.claimReceipt(review.receiptId, 'worker');
    await store.markReviewRequired(review.receiptId, 'manual verification required');
    expect(await store.claimReceipt(review.receiptId, 'worker-again')).toBeNull();
  });

  it('recovers an undispatched outbox job after a dispatch failure', async () => {
    const inserted = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `outbox-${randomUUID()}`,
      rawPayload: { outbox: true },
    });

    const firstBatch = await store.claimOutboxBatch(10);
    expect(firstBatch.some((job) => job.receiptId === inserted.receiptId)).toBe(true);

    const recoveredBatch = await store.claimOutboxBatch(10);
    const recovered = recoveredBatch.find((job) => job.receiptId === inserted.receiptId);
    expect(recovered).toBeDefined();
    await store.markOutboxDispatched(recovered!.jobId);

    expect((await store.claimOutboxBatch(10)).some((job) => job.jobId === recovered!.jobId)).toBe(false);
  });
}, 30_000);

if (!databaseUrl) {
  describe('PostgresStore configuration', () => {
    it.skip('requires TEST_DATABASE_URL and never falls back to production credentials', () => {
      expect.fail('Set TEST_DATABASE_URL to run PostgreSQL integration tests');
    });
  });
}
