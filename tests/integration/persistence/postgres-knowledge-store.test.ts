import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresKnowledgeStore } from '../../../src/persistence/postgres-knowledge-store.js';
import type { KnowledgeDocument } from '../../../src/ai/chatwoot-knowledge.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('PostgresKnowledgeStore (disposable TEST_DATABASE_URL only)', () => {
  let pool: Pool;
  let store: PostgresKnowledgeStore;
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    store = new PostgresKnowledgeStore(databaseUrl!);
    await store.initialize();
  });
  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS telnyx_bridge CASCADE');
    await pool.end();
    await store.close();
  });

  it('initializes snapshot tables and activates ordered knowledge', async () => {
    const profileId = `jama-${randomUUID()}`;
    const documents: KnowledgeDocument[] = [
      { sourceArticleId: 2, slug: 'two', title: 'Two', content: '2', sourceUpdatedAt: '2026-01-02T00:00:00.000Z', position: 2 },
      { sourceArticleId: 1, slug: 'one', title: 'One', content: '1', sourceUpdatedAt: '2026-01-01T00:00:00.000Z', position: 1 },
    ];
    const first = await store.activateChatwootSnapshot(profileId, documents, 'hash-1');
    expect(await store.getActiveKnowledge(profileId)).toMatchObject({ snapshot: { id: first.id, articleCount: 2 }, documents: [{ sourceArticleId: 1 }, { sourceArticleId: 2 }] });
    const second = await store.activateChatwootSnapshot(profileId, [documents[0]!], 'hash-2');
    expect((await store.getActiveKnowledge(profileId))?.snapshot.id).toBe(second.id);
    expect((await pool.query('SELECT count(*)::int AS count FROM telnyx_bridge.knowledge_snapshots WHERE profile_id = $1', [profileId])).rows[0].count).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS count FROM telnyx_bridge.knowledge_snapshots WHERE profile_id = $1 AND status = 'active'", [profileId])).rows[0].count).toBe(1);
  });

  it('returns null when no profile snapshot is active', async () => {
    expect(await store.getActiveKnowledge(`missing-${randomUUID()}`)).toBeNull();
  });
});

if (!databaseUrl) describe('PostgresKnowledgeStore configuration', () => {
  it.skip('requires TEST_DATABASE_URL and never falls back to production credentials', () => expect.fail('Set TEST_DATABASE_URL to run PostgreSQL integration tests'));
});
