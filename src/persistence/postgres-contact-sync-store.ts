import { Pool } from 'pg';
import { BRIDGE_SCHEMA, POSTGRES_SCHEMA_SQL } from './schema.js';
import type { ContactSyncCursor, ContactSyncRecord, ContactSyncStore } from './contact-sync-store.js';

const EPOCH = new Date(0);

export class PostgresContactSyncStore implements ContactSyncStore {
  readonly #pool: Pool;

  constructor(databaseUrl: string, pool?: Pool) {
    this.#pool = pool ?? new Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    await this.#pool.query(POSTGRES_SCHEMA_SQL);
    await this.#pool.query(
      `INSERT INTO ${BRIDGE_SCHEMA}.contact_sync_cursor (id, updated_at, contact_id)
       VALUES (1, $1, 0)
       ON CONFLICT (id) DO NOTHING`,
      [EPOCH],
    );
  }

  async getCursor(): Promise<ContactSyncCursor> {
    const result = await this.#pool.query<{ updated_at: Date; contact_id: string }>(
      `SELECT updated_at, contact_id FROM ${BRIDGE_SCHEMA}.contact_sync_cursor WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) return { updatedAt: EPOCH, contactId: 0 };
    return { updatedAt: row.updated_at, contactId: Number(row.contact_id) };
  }

  async setCursor(cursor: ContactSyncCursor): Promise<void> {
    await this.#pool.query(
      `UPDATE ${BRIDGE_SCHEMA}.contact_sync_cursor
       SET updated_at = $1, contact_id = $2
       WHERE id = 1`,
      [cursor.updatedAt, cursor.contactId],
    );
  }

  async getRecord(sourceContactId: number): Promise<ContactSyncRecord | null> {
    const result = await this.#pool.query<{
      source_contact_id: string;
      chatwoot_contact_id: string;
      content_hash: string;
      source_updated_at: Date;
    }>(
      `SELECT source_contact_id, chatwoot_contact_id, content_hash, source_updated_at
       FROM ${BRIDGE_SCHEMA}.contact_sync_state
       WHERE source_contact_id = $1`,
      [sourceContactId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sourceContactId: Number(row.source_contact_id),
      chatwootContactId: Number(row.chatwoot_contact_id),
      contentHash: row.content_hash,
      sourceUpdatedAt: row.source_updated_at,
    };
  }

  async saveRecord(record: ContactSyncRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO ${BRIDGE_SCHEMA}.contact_sync_state
         (source_contact_id, chatwoot_contact_id, content_hash, source_updated_at, synced_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (source_contact_id) DO UPDATE SET
         chatwoot_contact_id = EXCLUDED.chatwoot_contact_id,
         content_hash = EXCLUDED.content_hash,
         source_updated_at = EXCLUDED.source_updated_at,
         synced_at = now()`,
      [record.sourceContactId, record.chatwootContactId, record.contentHash, record.sourceUpdatedAt],
    );
  }
}
