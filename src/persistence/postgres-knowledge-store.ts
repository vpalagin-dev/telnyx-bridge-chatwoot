import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { KnowledgeDocument } from '../ai/chatwoot-knowledge.js';
import { BRIDGE_SCHEMA, POSTGRES_SCHEMA_SQL } from './schema.js';
import type { ActiveKnowledge, KnowledgeSnapshot, KnowledgeStore } from './knowledge-store.js';

type SnapshotRow = { id: string; profile_id: string; source: 'chatwoot' | 'local'; content_hash: string; article_count: number; activated_at: Date };
type DocumentRow = { source_article_id: string | number; slug: string; title: string; content: string; source_updated_at: Date; position: number };

export class PostgresKnowledgeStore implements KnowledgeStore {
  readonly #pool: Pool;
  constructor(databaseUrl: string, pool = new Pool({ connectionString: databaseUrl })) { this.#pool = pool; }
  async initialize(): Promise<void> { await this.#pool.query(POSTGRES_SCHEMA_SQL); }
  async close(): Promise<void> { await this.#pool.end(); }

  async activateChatwootSnapshot(profileId: string, documents: KnowledgeDocument[], contentHash: string): Promise<KnowledgeSnapshot> {
    return this.#transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [profileId]);
      const id = randomUUID();
      await client.query(
        `INSERT INTO ${BRIDGE_SCHEMA}.knowledge_snapshots (id, profile_id, source, content_hash, article_count, status)
         VALUES ($1, $2, 'chatwoot', $3, $4, 'draft')`,
        [id, profileId, contentHash, documents.length],
      );
      for (const document of documents) {
        await client.query(
          `INSERT INTO ${BRIDGE_SCHEMA}.knowledge_documents
             (snapshot_id, source_article_id, slug, title, content, source_updated_at, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, document.sourceArticleId, document.slug, document.title, document.content, document.sourceUpdatedAt, document.position],
        );
      }
      await client.query(`UPDATE ${BRIDGE_SCHEMA}.knowledge_snapshots SET status = 'superseded' WHERE profile_id = $1 AND status = 'active'`, [profileId]);
      const activated = await client.query<SnapshotRow>(
        `UPDATE ${BRIDGE_SCHEMA}.knowledge_snapshots
         SET status = 'active', activated_at = now()
         WHERE id = $1
         RETURNING id, profile_id, source, content_hash, article_count, activated_at`,
        [id],
      );
      if (activated.rowCount !== 1) throw new Error(`Knowledge snapshot ${id} was not activated`);
      return mapSnapshot(activated.rows[0]!);
    });
  }

  async getActiveKnowledge(profileId: string): Promise<ActiveKnowledge | null> {
    const active = await this.#pool.query<SnapshotRow>(
      `SELECT id, profile_id, source, content_hash, article_count, activated_at
       FROM ${BRIDGE_SCHEMA}.knowledge_snapshots
       WHERE profile_id = $1 AND status = 'active'`, [profileId],
    );
    if (active.rowCount !== 1) return null;
    const row = active.rows[0]!;
    const documents = await this.#pool.query<DocumentRow>(
      `SELECT source_article_id, slug, title, content, source_updated_at, position
       FROM ${BRIDGE_SCHEMA}.knowledge_documents
       WHERE snapshot_id = $1 ORDER BY position ASC, source_article_id ASC`, [row.id],
    );
    return { snapshot: mapSnapshot(row), documents: documents.rows.map(mapDocument) };
  }

  async #transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

function mapSnapshot(row: SnapshotRow): KnowledgeSnapshot {
  return { id: row.id, profileId: row.profile_id, source: row.source, contentHash: row.content_hash, articleCount: Number(row.article_count), activatedAt: new Date(row.activated_at).toISOString() };
}
function mapDocument(row: DocumentRow): KnowledgeDocument {
  return { sourceArticleId: Number(row.source_article_id), slug: row.slug, title: row.title, content: row.content, sourceUpdatedAt: new Date(row.source_updated_at).toISOString(), position: Number(row.position) };
}
