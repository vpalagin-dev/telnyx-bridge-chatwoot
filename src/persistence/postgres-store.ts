import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { BRIDGE_SCHEMA, POSTGRES_SCHEMA_SQL } from './schema.js';

export type ReceiptStatus = 'pending' | 'processing' | 'completed' | 'retryable' | 'needs_review';

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
};

export type OutboxJob = {
  jobId: string;
  receiptId: string;
  dispatchedAt: Date | null;
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
};

type OutboxRow = {
  job_id: string;
  receipt_id: string;
  dispatched_at: Date | null;
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

  async claimReceipt(receiptId: string, workerId: string): Promise<Receipt | null> {
    return this.#transaction(async (client) => {
      const candidate = await client.query<ReceiptRow>(
        `SELECT * FROM ${BRIDGE_SCHEMA}.webhook_receipts
         WHERE receipt_id = $1
           AND status IN ('pending', 'retryable')
           AND next_attempt_at <= now()
         FOR UPDATE SKIP LOCKED`,
        [receiptId],
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

  async completeReceipt(receiptId: string, _result?: unknown): Promise<void> {
    await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
       SET status = 'completed', processed_at = now(), locked_by = NULL,
           locked_at = NULL, last_error = NULL
       WHERE receipt_id = $1`,
      [receiptId],
    );
  }

  async retryReceipt(receiptId: string, error: Error | string, nextAttemptAt: Date): Promise<void> {
    const message = error instanceof Error ? error.message : error;
    await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
       SET status = 'retryable', attempts = attempts + 1, next_attempt_at = $2,
           last_error = $3, locked_by = NULL, locked_at = NULL
       WHERE receipt_id = $1`,
      [receiptId, nextAttemptAt, message],
    );
  }

  async markReviewRequired(receiptId: string, reason: string): Promise<void> {
    await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_receipts
       SET status = 'needs_review', processed_at = now(), last_error = $2,
           locked_by = NULL, locked_at = NULL
       WHERE receipt_id = $1`,
      [receiptId, reason],
    );
  }

  async claimOutboxBatch(limit: number): Promise<OutboxJob[]> {
    return this.#transaction(async (client) => {
      const result = await client.query<OutboxRow>(
        `SELECT job_id, receipt_id, dispatched_at, created_at
         FROM ${BRIDGE_SCHEMA}.webhook_outbox
         WHERE dispatched_at IS NULL
         ORDER BY created_at, job_id
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [Math.max(0, Math.floor(limit))],
      );
      return result.rows.map(mapOutboxJob);
    });
  }

  async markOutboxDispatched(jobId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.webhook_outbox
       SET dispatched_at = now()
       WHERE job_id = $1`,
      [jobId],
    );
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
  };
}

function mapOutboxJob(row: OutboxRow): OutboxJob {
  return {
    jobId: row.job_id,
    receiptId: row.receipt_id,
    dispatchedAt: row.dispatched_at,
    createdAt: row.created_at,
  };
}
