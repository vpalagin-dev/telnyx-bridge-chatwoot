import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { KnowledgeStore, KnowledgeSnapshot } from '../../../src/persistence/knowledge-store.js';
import { PostgresKnowledgeStore } from '../../../src/persistence/postgres-knowledge-store.js';
import { POSTGRES_SCHEMA_SQL } from '../../../src/persistence/schema.js';
import type { KnowledgeDocument } from '../../../src/ai/chatwoot-knowledge.js';

const documents: KnowledgeDocument[] = [
  { sourceArticleId: 2, slug: 'second', title: 'Second', content: 'two', sourceUpdatedAt: '2026-01-02T00:00:00.000Z', position: 2 },
  { sourceArticleId: 1, slug: 'first', title: 'First', content: 'one', sourceUpdatedAt: '2026-01-01T00:00:00.000Z', position: 1 },
];

describe('PostgresKnowledgeStore', () => {
  it('defines upgrade-safe snapshot and document tables with active profile uniqueness', () => {
    expect(POSTGRES_SCHEMA_SQL).toContain('knowledge_snapshots');
    expect(POSTGRES_SCHEMA_SQL).toContain('knowledge_documents');
    expect(POSTGRES_SCHEMA_SQL).toContain("WHERE status = 'active'");
    expect(POSTGRES_SCHEMA_SQL).toContain("CHECK (source IN ('chatwoot', 'local'))");
  });

  it('activates a complete document set and returns the snapshot', async () => {
    const queries: string[] = [];
    const client = fakeClient(queries, {
      insertSnapshot: 'snapshot-1',
      activeRows: [],
    });
    const store = new PostgresKnowledgeStore('postgres://unused', fakePool(client));

    const snapshot = await store.activateChatwootSnapshot('jama-ama-v1.3', documents, 'hash-1');

    expect(snapshot).toMatchObject({ id: 'snapshot-1', profileId: 'jama-ama-v1.3', source: 'chatwoot', contentHash: 'hash-1', articleCount: 2 });
    expect(queries.some((query) => query.includes('INSERT INTO telnyx_bridge.knowledge_documents'))).toBe(true);
    expect(queries.some((query) => query.includes("SET status = 'superseded'"))).toBe(true);
    expect(queries.some((query) => query.includes("SET status = 'active'"))).toBe(true);
  });

  it('returns active knowledge with documents ordered by position', async () => {
    const client = fakeClient([], {
      activeRows: [{ id: 'snapshot-1', profile_id: 'jama-ama-v1.3', source: 'chatwoot', content_hash: 'hash-1', article_count: 2, activated_at: new Date('2026-01-03T00:00:00.000Z') }],
      documentRows: [documents[1]!, documents[0]!].map((document) => ({ source_article_id: document.sourceArticleId, slug: document.slug, title: document.title, content: document.content, source_updated_at: new Date(document.sourceUpdatedAt), position: document.position })),
    });
    const store = new PostgresKnowledgeStore('postgres://unused', fakePool(client));

    const result = await store.getActiveKnowledge('jama-ama-v1.3');

    expect(result?.documents.map((document) => document.sourceArticleId)).toEqual([1, 2]);
    expect(result?.snapshot.activatedAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('rolls back activation when document insertion fails', async () => {
    const queries: string[] = [];
    const client = fakeClient(queries, { insertSnapshot: 'snapshot-1', failDocuments: true });
    const store = new PostgresKnowledgeStore('postgres://unused', fakePool(client));

    await expect(store.activateChatwootSnapshot('profile', documents, 'hash')).rejects.toThrow('document insert failed');
    expect(queries).toEqual(expect.arrayContaining(['BEGIN', 'ROLLBACK']));
    expect(queries).not.toContain('COMMIT');
  });
});

function fakePool(client: PoolClient): Pool {
  return { connect: async () => client, query: (...args: unknown[]) => (client.query as unknown as (...queryArgs: unknown[]) => Promise<unknown>)(...args) } as unknown as Pool;
}

function fakeClient(queries: string[], options: { insertSnapshot?: string; activeRows?: unknown[]; documentRows?: unknown[]; failDocuments?: boolean }): PoolClient {
  return {
    async query(sql: string) {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: null, rows: [] };
      if (sql.includes('INSERT INTO telnyx_bridge.knowledge_snapshots')) return { rowCount: 1, rows: [{ id: options.insertSnapshot ?? 'snapshot-1', profile_id: 'jama-ama-v1.3', source: 'chatwoot', content_hash: 'hash-1', article_count: 2, activated_at: new Date('2026-01-03T00:00:00.000Z') }] };
      if (sql.includes('INSERT INTO telnyx_bridge.knowledge_documents') && options.failDocuments) throw new Error('document insert failed');
      if (sql.includes("SET status = 'active'")) return { rowCount: 1, rows: [{ id: options.insertSnapshot ?? 'snapshot-1', profile_id: 'jama-ama-v1.3', source: 'chatwoot', content_hash: 'hash-1', article_count: 2, activated_at: new Date('2026-01-03T00:00:00.000Z') }] };
      if (sql.includes('SELECT id, profile_id')) return { rowCount: options.activeRows?.length ?? 0, rows: options.activeRows ?? [] };
      if (sql.includes('SELECT source_article_id')) return { rowCount: options.documentRows?.length ?? 0, rows: options.documentRows ?? [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
}

void (null as unknown as KnowledgeStore);
void (null as unknown as KnowledgeSnapshot);
void (null as unknown as KnowledgeDocument);
