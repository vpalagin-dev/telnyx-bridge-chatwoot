import { Pool } from 'pg';
import { BRIDGE_SCHEMA } from '../persistence/schema.js';
import type { BroadcastCampaign, BroadcastStore } from './types.js';

type Row = {
  campaign_id: string;
  title: string;
  message: string;
  inbox_id: string;
  label: string | null;
  scheduled_at: Date;
  status: BroadcastCampaign['status'];
  sent_count: number;
  skipped_count: number;
  failed_count: number;
  last_error: string | null;
};

function mapRow(row: Row): BroadcastCampaign {
  return {
    campaignId: row.campaign_id,
    title: row.title,
    message: row.message,
    inboxId: Number(row.inbox_id),
    label: row.label,
    scheduledAt: row.scheduled_at,
    status: row.status,
    sentCount: row.sent_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
  };
}

export class PostgresBroadcastStore implements BroadcastStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string, pool?: Pool) {
    this.#pool = pool ?? new Pool({ connectionString: databaseUrl });
  }

  async createCampaign(input: Omit<BroadcastCampaign, 'status' | 'sentCount' | 'skippedCount' | 'failedCount' | 'lastError'>): Promise<void> {
    await this.#pool.query(
      `INSERT INTO ${BRIDGE_SCHEMA}.broadcast_campaigns
        (campaign_id, title, message, inbox_id, label, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')`,
      [input.campaignId, input.title, input.message, input.inboxId, input.label, input.scheduledAt],
    );
  }

  async claimDueCampaign(): Promise<BroadcastCampaign | null> {
    const result = await this.#pool.query<Row>(
      `UPDATE ${BRIDGE_SCHEMA}.broadcast_campaigns AS c
       SET status = 'running', started_at = COALESCE(started_at, now())
       FROM (
         SELECT campaign_id FROM ${BRIDGE_SCHEMA}.broadcast_campaigns
         WHERE status = 'scheduled' AND scheduled_at <= now()
         ORDER BY scheduled_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       ) picked
       WHERE c.campaign_id = picked.campaign_id
       RETURNING c.*`,
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async updateProgress(
    campaignId: string,
    patch: Partial<Pick<BroadcastCampaign, 'sentCount' | 'skippedCount' | 'failedCount' | 'lastError' | 'status'>> & { completed?: boolean },
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [campaignId];
    let index = 2;
    if (patch.sentCount !== undefined) { sets.push(`sent_count = $${index++}`); values.push(patch.sentCount); }
    if (patch.skippedCount !== undefined) { sets.push(`skipped_count = $${index++}`); values.push(patch.skippedCount); }
    if (patch.failedCount !== undefined) { sets.push(`failed_count = $${index++}`); values.push(patch.failedCount); }
    if (patch.lastError !== undefined) { sets.push(`last_error = $${index++}`); values.push(patch.lastError); }
    if (patch.status !== undefined) { sets.push(`status = $${index++}`); values.push(patch.status); }
    if (patch.completed) sets.push('completed_at = now()');
    if (sets.length === 0) return;
    await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.broadcast_campaigns SET ${sets.join(', ')} WHERE campaign_id = $1`,
      values,
    );
  }
}
