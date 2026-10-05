import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { BRIDGE_SCHEMA, POSTGRES_SCHEMA_SQL } from './schema.js';

export type ReceiptStatus = 'pending' | 'processing' | 'completed' | 'retryable' | 'needs_review';
export type ReceiptResultCode = 'processed' | 'retryable' | 'needs_review';

export type Receipt = {
  receiptId: string;
  provider: string;
  providerEventId: string;
  rawPayload: unknown;
  status: ReceiptStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  lastError: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  resultCode: ReceiptResultCode | null;
};

export type OutboxJob = {
  jobId: string;
  receiptId: string;
  /** Last successful Redis publication; expires as a recovery lease. */
  publishedAt: Date | null;
  /** Dispatcher publication lease, independent from receipt worker ownership. */
  publicationClaimedBy: string | null;
  publicationClaimedAt: Date | null;
  /** @deprecated aliases for the previous publication-lease names. */
  dispatchedAt: Date | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  createdAt: Date;
};

export type InsertReceiptInput = {
  provider: string;
  providerEventId: string;
  rawPayload: unknown;
};

type ReceiptRow = {
  receipt_id: string;
  provider: string;
  provider_event_id: string;
  raw_payload: unknown;
  status: ReceiptStatus;
  attempts: number;
  next_attempt_at: Date;
  locked_by: string | null;
  locked_at: Date | null;
  last_error: string | null;
  received_at: Date;
  processed_at: Date | null;
  result_code: ReceiptResultCode | null;
};

type OutboxRow = {
  job_id: string;
  receipt_id: string;
  published_at: Date | null;
  publication_claimed_by: string | null;
  publication_claimed_at: Date | null;
  created_at: Date;
};

export class PostgresStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string, pool = new Pool({ connectionString: databaseUrl })) {
    this.#pool = pool;
  }

  async initialize(): Promise<void> {
    await this.#pool.query(POSTGRES_SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async insertReceipt(input: InsertReceiptInput): Promise<{ inserted: boolean; receiptId: string }> {
    const client = await this.#pool.connect();
    const receiptId = randomUUID();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ receipt_id: string }>(
        `INSERT INTO ${BRIDGE_SCHEMA}.webhook_receipts
          (receipt_id, provider, provider_event_id, raw_payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING receipt_id`,
        [receiptId, input.provider, input.providerEventId, input.rawPayload],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          `INSERT INTO ${BRIDGE_SCHEMA}.webhook_outbox (job_id, receipt_id)
           VALUES ($1, $2)`,
          [randomUUID(), receiptId],
        );
        await client.query('COMMIT');
        return { inserted: true, receiptId };
      }

      const existing = await client.query<{ receipt_id: string }>(
        `SELECT receipt_id FROM ${BRIDGE_SCHEMA}.webhook_receipts
         WHERE provider = $1 AND provider_event_id = $2`,
        [input.provider, input.providerEventId],
      );
      if (existing.rowCount !== 1) throw new Error('Receipt deduplication lookup returned no row');
      await client.query('COMMIT');
      return { inserted: false, receiptId: existing.rows[0]!.receipt_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimReceipt(receiptId: string, workerId: string, leaseDurationMs = 30_000): Promise<Receipt | null> {
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) throw new Error('leaseDurationMs must be positive and finite');
    const leaseCutoff = new Date(Date.now() - leaseDurationMs);
    return this.#transaction(async (client) => {
      const candidate = await client.query<ReceiptRow>(
        `SELECT * FROM ${BRIDGE_SCHEMA}.webhook_receipts
         WHERE receipt_id = $1
           AND ((status IN ('pending', 'retryable') AND next_attempt_at <= now())
             OR (status = 'processing' AND locked_at <= $2))
         FOR UPDATE SKIP LOCKED`,
        [receiptId, leaseCutoff],
      );
      if (candidate.rowCount !== 1) return null;
      const claimed = await client.query<ReceiptRow>(
        `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
         SET status = 'processing', locked_by = $2, locked_at = now()
         WHERE receipt_id = $1
         RETURNING *`,
        [receiptId, workerId],
      );
      return claimed.rowCount === 1 ? mapReceipt(claimed.rows[0]!) : null;
    });
  }

  async completeReceipt(
    receiptId: string,
    workerId: string,
    resultCode: ReceiptResultCode = 'processed',
  ): Promise<void> {
    assertCompletionResultCode(resultCode);
    const result = await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
       SET status = 'completed', processed_at = now(), result_code = $3,
           locked_by = NULL, locked_at = NULL, last_error = NULL
       WHERE receipt_id = $1 AND status = 'processing' AND locked_by = $2`,
      [receiptId, workerId, resultCode],
    );
    assertOwnedTransition(result.rowCount, receiptId, workerId);
  }

  async retryReceipt(
    receiptId: string,
    workerId: string,
    error: Error | string,
    nextAttemptAt: Date,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : error;
    const result = await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
       SET status = 'retryable', attempts = attempts + 1, next_attempt_at = $3,
           result_code = 'retryable', last_error = $4, locked_by = NULL, locked_at = NULL
       WHERE receipt_id = $1 AND status = 'processing' AND locked_by = $2`,
      [receiptId, workerId, nextAttemptAt, message],
    );
    assertOwnedTransition(result.rowCount, receiptId, workerId);
  }

  async markReviewRequired(receiptId: string, workerId: string, reason: string): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
       SET status = 'needs_review', processed_at = now(), result_code = 'needs_review',
           last_error = $3, locked_by = NULL, locked_at = NULL
       WHERE receipt_id = $1 AND status = 'processing' AND locked_by = $2`,
      [receiptId, workerId, reason],
    );
    assertOwnedTransition(result.rowCount, receiptId, workerId);
  }

  async claimOutboxPublicationBatch(
    limit: number,
    dispatcherId: string,
    leaseDurationMs = 30_000,
  ): Promise<OutboxJob[]> {
    const normalizedLimit = Math.max(0, Math.floor(limit));
    if (normalizedLimit === 0) return [];
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs < 0) throw new Error('leaseDurationMs must be non-negative and finite');
    const leaseCutoff = new Date(Date.now() - leaseDurationMs);
    return this.#transaction(async (client) => {
      const result = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT outbox.job_id
           FROM ${BRIDGE_SCHEMA}.webhook_outbox AS outbox
           JOIN ${BRIDGE_SCHEMA}.webhook_receipts AS receipt ON receipt.receipt_id = outbox.receipt_id
           WHERE receipt.status NOT IN ('completed', 'needs_review')
             AND (outbox.published_at IS NULL OR outbox.published_at <= $2)
             AND (outbox.publication_claimed_at IS NULL OR outbox.publication_claimed_at <= $2)
           ORDER BY outbox.created_at, outbox.job_id
           LIMIT $1
           FOR UPDATE OF outbox SKIP LOCKED
         )
         UPDATE ${BRIDGE_SCHEMA}.webhook_outbox AS outbox
         SET publication_claimed_by = $3, publication_claimed_at = now()
         FROM candidates
         WHERE outbox.job_id = candidates.job_id
         RETURNING outbox.job_id, outbox.receipt_id, outbox.published_at,
                   outbox.publication_claimed_by, outbox.publication_claimed_at, outbox.created_at`,
        [normalizedLimit, leaseCutoff, dispatcherId],
      );
      return result.rows.map(mapOutboxJob);
    });
  }

  /** @deprecated Use claimOutboxPublicationBatch; retained for callers from Task 3. */
  async claimOutboxBatch(limit: number, dispatcherId: string, leaseDurationMs = 30_000): Promise<OutboxJob[]> {
    return this.claimOutboxPublicationBatch(limit, dispatcherId, leaseDurationMs);
  }

  async getOutboxReceipt(jobId: string): Promise<string | null> {
    const result = await this.#pool.query<{ receipt_id: string }>(
      `SELECT receipt_id FROM ${BRIDGE_SCHEMA}.webhook_outbox WHERE job_id = $1`,
      [jobId],
    );
    return result.rowCount === 1 ? result.rows[0]!.receipt_id : null;
  }

  async markOutboxPublished(jobId: string, dispatcherId: string, leaseDurationMs = 30_000): Promise<void> {
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error('leaseDurationMs must be positive and finite');
    }
    const leaseCutoff = new Date(Date.now() - leaseDurationMs);
    const result = await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_outbox
       SET published_at = now(), publication_claimed_by = NULL, publication_claimed_at = NULL
       WHERE job_id = $1 AND publication_claimed_by = $2 AND publication_claimed_at > $3`,
      [jobId, dispatcherId, leaseCutoff],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Outbox job ${jobId} is not owned by dispatcher ${dispatcherId}`);
    }
  }

  /** @deprecated Use markOutboxPublished; retained for callers from Task 3. */
  async markOutboxDispatched(jobId: string, dispatcherId: string, leaseDurationMs = 30_000): Promise<void> {
    return this.markOutboxPublished(jobId, dispatcherId, leaseDurationMs);
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapReceipt(row: ReceiptRow): Receipt {
  return {
    receiptId: row.receipt_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    rawPayload: row.raw_payload,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    resultCode: row.result_code,
  };
}

function mapOutboxJob(row: OutboxRow): OutboxJob {
  return {
    jobId: row.job_id,
    receiptId: row.receipt_id,
    publishedAt: row.published_at,
    publicationClaimedBy: row.publication_claimed_by,
    publicationClaimedAt: row.publication_claimed_at,
    dispatchedAt: row.published_at,
    claimedBy: row.publication_claimed_by,
    claimedAt: row.publication_claimed_at,
    createdAt: row.created_at,
  };
}

function assertCompletionResultCode(resultCode: ReceiptResultCode): void {
  if (resultCode !== 'processed') {
    throw new Error(`Completion result code must be processed, received ${resultCode}`);
  }
}

function assertOwnedTransition(rowCount: number | null, receiptId: string, workerId: string): void {
  if (rowCount !== 1) {
    throw new Error(`Receipt ${receiptId} is not owned by worker ${workerId}`);
  }
}
