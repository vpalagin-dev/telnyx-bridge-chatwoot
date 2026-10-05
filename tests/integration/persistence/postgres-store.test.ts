import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

  beforeEach(async () => {
    const jobs = await store.claimOutboxBatch(100, 'test-cleanup', 0);
    for (const job of jobs) await store.markOutboxDispatched(job.jobId, 'test-cleanup');
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

    const jobs = await store.claimOutboxBatch(10, 'worker-a');
    expect(jobs.filter((job) => job.receiptId === first.receiptId)).toHaveLength(1);
    expect(jobs.find((job) => job.receiptId === first.receiptId)?.claimedBy).toBe('worker-a');
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
    await store.retryReceipt(inserted.receiptId, 'worker', new Error('downstream unavailable'), nextAttemptAt);

    const retry = await store.claimReceipt(inserted.receiptId, 'worker-retry');
    expect(retry).toMatchObject({
      receiptId: inserted.receiptId,
      status: 'processing',
      attempts: 1,
      lockedBy: 'worker-retry',
      lastError: 'downstream unavailable',
    });
  });

  it.each(['retryable', 'needs_review'] as const)('rejects contradictory completion result code %s', async (resultCode) => {
    const inserted = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `complete-contradictory-${resultCode}-${randomUUID()}`,
      rawPayload: { complete: true },
    });
    await store.claimReceipt(inserted.receiptId, 'worker');

    await expect(store.completeReceipt(inserted.receiptId, 'worker', resultCode)).rejects.toThrow(
      /completion result code must be processed/i,
    );
    const row = await pool.query<{ status: string; result_code: string | null }>(
      'SELECT status, result_code FROM telnyx_bridge.webhook_receipts WHERE receipt_id = $1',
      [inserted.receiptId],
    );
    expect(row.rows[0]).toEqual({ status: 'processing', result_code: null });
  });

  it('records completion and review-required outcomes', async () => {
    const completed = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `complete-${randomUUID()}`,
      rawPayload: { complete: true },
    });
    await store.claimReceipt(completed.receiptId, 'worker');
    await store.completeReceipt(completed.receiptId, 'worker', 'processed');
    const completedRow = await pool.query<{ result_code: string }>('SELECT result_code FROM telnyx_bridge.webhook_receipts WHERE receipt_id = $1', [completed.receiptId]);
    expect(completedRow.rows[0]?.result_code).toBe('processed');
    expect(await store.claimReceipt(completed.receiptId, 'worker-again')).toBeNull();

    const review = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `review-${randomUUID()}`,
      rawPayload: { review: true },
    });
    await store.claimReceipt(review.receiptId, 'worker');
    await store.markReviewRequired(review.receiptId, 'worker', 'manual verification required');
    expect(await store.claimReceipt(review.receiptId, 'worker-again')).toBeNull();
  });

  it('atomically assigns different outbox jobs to concurrent dispatchers', async () => {
    const first = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `outbox-a-${randomUUID()}`,
      rawPayload: { outbox: 'a' },
    });
    const second = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `outbox-b-${randomUUID()}`,
      rawPayload: { outbox: 'b' },
    });

    const [a, b] = await Promise.all([
      store.claimOutboxBatch(1, 'dispatcher-a'),
      store.claimOutboxBatch(1, 'dispatcher-b'),
    ]);
    const claimed = [...a, ...b].filter((job) => job.receiptId === first.receiptId || job.receiptId === second.receiptId);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map((job) => job.receiptId))).toEqual(new Set([first.receiptId, second.receiptId]));
    expect(new Set(claimed.map((job) => job.claimedBy))).toEqual(new Set(['dispatcher-a', 'dispatcher-b']));
  });

  it('recovers an undispatched outbox job after its lease expires', async () => {
    const inserted = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `outbox-recovery-${randomUUID()}`,
      rawPayload: { outbox: true },
    });

    const firstBatch = await store.claimOutboxBatch(1, 'dispatcher-a', 1);
    const claimed = firstBatch.find((job) => job.receiptId === inserted.receiptId);
    expect(claimed?.claimedBy).toBe('dispatcher-a');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const recoveredBatch = await store.claimOutboxBatch(10, 'dispatcher-b', 1);
    const recovered = recoveredBatch.find((job) => job.jobId === claimed?.jobId);
    expect(recovered?.claimedBy).toBe('dispatcher-b');
    await store.markOutboxDispatched(recovered!.jobId, 'dispatcher-b');
    expect((await store.claimOutboxBatch(10, 'dispatcher-b')).some((job) => job.jobId === recovered!.jobId)).toBe(false);
  });

  it('rejects stale receipt workers from overwriting terminal outcomes', async () => {
    const completed = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `ownership-complete-${randomUUID()}`,
      rawPayload: { ownership: 'complete' },
    });
    await store.claimReceipt(completed.receiptId, 'worker-a');
    await expect(store.completeReceipt(completed.receiptId, 'worker-b', 'processed')).rejects.toThrow(/ownership/i);
    await store.completeReceipt(completed.receiptId, 'worker-a', 'processed');
    await expect(store.retryReceipt(completed.receiptId, 'worker-b', 'late failure', new Date())).rejects.toThrow(/ownership/i);

    const review = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `ownership-review-${randomUUID()}`,
      rawPayload: { ownership: 'review' },
    });
    await store.claimReceipt(review.receiptId, 'worker-a');
    await store.markReviewRequired(review.receiptId, 'worker-a', 'manual verification required');
    await expect(store.completeReceipt(review.receiptId, 'worker-b')).rejects.toThrow(/ownership/i);
  });

  it('rejects a stale dispatcher from marking an outbox job dispatched', async () => {
    const inserted = await store.insertReceipt({
      provider: 'telnyx',
      providerEventId: `outbox-owner-${randomUUID()}`,
      rawPayload: { outbox: 'owner' },
    });
    const [job] = await store.claimOutboxBatch(1, 'dispatcher-a');
    expect(job?.receiptId).toBe(inserted.receiptId);
    await expect(store.markOutboxDispatched(job!.jobId, 'dispatcher-b')).rejects.toThrow(/ownership/i);
    await store.markOutboxDispatched(job!.jobId, 'dispatcher-a');
  });
}, 30_000);

if (!databaseUrl) {
  describe('PostgresStore configuration', () => {
    it.skip('requires TEST_DATABASE_URL and never falls back to production credentials', () => {
      expect.fail('Set TEST_DATABASE_URL to run PostgreSQL integration tests');
    });
  });
}
