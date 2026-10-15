import { describe, expect, it, vi } from 'vitest';
import {
  createChatwootHelpCenterClient,
  normalizeKnowledgeArticle,
  type ChatwootKnowledgeArticle,
} from '../../../src/ai/chatwoot-knowledge.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const article = (overrides: Partial<ChatwootKnowledgeArticle> = {}): ChatwootKnowledgeArticle => ({
  id: 1,
  slug: 'founders',
  title: 'Who founded JAMA?',
  content: '```\nJAMA! was founded...\n```',
  status: 'published',
  updatedAt: 1792090615,
  position: 10,
  ...overrides,
});

const apiArticle = (overrides: Partial<ChatwootKnowledgeArticle> = {}) => {
  const value = article(overrides);
  return {
    id: value.id,
    slug: value.slug,
    title: value.title,
    content: value.content,
    status: value.status,
    updated_at: value.updatedAt,
    position: value.position,
  };
};

describe('Chatwoot Help Center knowledge client', () => {
  it('fetches every reported page and returns only published articles', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        payload: [apiArticle(), apiArticle({ id: 2, slug: 'draft', title: 'Private draft', content: 'Do not use', status: 'draft', updatedAt: 1792090616, position: 20 })],
        meta: { current_page: 1, total_pages: 2, articles_count: 3, published_count: 2 },
      }))
      .mockResolvedValueOnce(response({
        payload: [apiArticle({ id: 3, slug: 'second', title: 'Second?', updatedAt: '2026-10-15T00:00:00Z', position: 30 })],
        meta: { current_page: 2, total_pages: 2, articles_count: 3, published_count: 2 },
      }));
    const client = createChatwootHelpCenterClient({
      baseUrl: 'http://localhost:3001/', accountId: 6, apiToken: 'token', portalSlug: 'jama-help-center', locale: 'en', fetcher,
    });

    await expect(client.listPublishedArticles()).resolves.toEqual([article(), article({ id: 3, slug: 'second', title: 'Second?', updatedAt: '2026-10-15T00:00:00Z', position: 30 })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/v1/accounts/6/portals/jama-help-center/articles?locale=en&page=1');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', headers: { api_access_token: 'token', Accept: 'application/json' } });
    expect(fetcher.mock.calls[1]?.[0]).toContain('page=2');
  });

  it('rejects non-2xx, malformed responses, invalid articles, and incomplete pagination', async () => {
    const cases: Array<{ body: unknown; status?: number; error: string }> = [
      { body: { error: 'nope' }, status: 500, error: 'chatwoot_knowledge_http_500' },
      { body: { meta: { current_page: 1, total_pages: 1 } }, error: 'chatwoot_knowledge_missing_payload' },
      { body: { payload: [apiArticle()], meta: { current_page: 1 } }, error: 'chatwoot_knowledge_incomplete_page' },
      { body: { payload: [{ ...apiArticle(), id: -1 }], meta: { current_page: 1, total_pages: 1 } }, error: 'chatwoot_knowledge_invalid_article' },
      { body: { payload: [{ ...apiArticle(), title: '   ' }], meta: { current_page: 1, total_pages: 1 } }, error: 'chatwoot_knowledge_invalid_article' },
      { body: { payload: [{ ...apiArticle(), status: '' }], meta: { current_page: 1, total_pages: 1 } }, error: 'chatwoot_knowledge_invalid_article' },
      { body: { payload: [{ ...apiArticle(), position: -1 }], meta: { current_page: 1, total_pages: 1 } }, error: 'chatwoot_knowledge_invalid_article' },
      { body: { payload: [], meta: { current_page: 1, total_pages: 1, published_count: 1 } }, error: 'chatwoot_knowledge_incomplete_page' },
      { body: { payload: [], meta: { current_page: 1, total_pages: 1, published_count: 0 } }, error: 'chatwoot_knowledge_incomplete_page' },
      { body: { payload: [apiArticle()], meta: { current_page: 1, total_pages: 1, articles_count: 2, published_count: 1 } }, error: 'chatwoot_knowledge_incomplete_page' },
    ];
    for (const testCase of cases) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(testCase.body, testCase.status ?? 200));
      const client = createChatwootHelpCenterClient({ baseUrl: 'http://localhost:3001', accountId: 6, apiToken: 'token', portalSlug: 'portal', locale: 'en', fetcher });
      await expect(client.listPublishedArticles()).rejects.toThrow(testCase.error);
    }
  });

  it('continues from a draft-only page to collect later published articles', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        payload: [apiArticle({ id: 10, status: 'draft', content: 'Draft' })],
        meta: { current_page: 1, articles_count: 2, published_count: 1 },
      }))
      .mockResolvedValueOnce(response({
        payload: [apiArticle({ id: 11, slug: 'published-later' })],
        meta: { current_page: 2, articles_count: 2, published_count: 1 },
      }));
    const client = createChatwootHelpCenterClient({ baseUrl: 'http://localhost:3001', accountId: 6, apiToken: 'token', portalSlug: 'portal', locale: 'en', fetcher });

    await expect(client.listPublishedArticles()).resolves.toEqual([article({ id: 11, slug: 'published-later' })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('accepts an explicitly proven empty dataset', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      payload: [],
      meta: { current_page: 1, total_pages: 1, articles_count: 0, published_count: 0 },
    }));
    const client = createChatwootHelpCenterClient({ baseUrl: 'http://localhost:3001', accountId: 6, apiToken: 'token', portalSlug: 'portal', locale: 'en', fetcher });

    await expect(client.listPublishedArticles()).resolves.toEqual([]);
  });

  it('preserves whitespace exactly when content has no known wrapper', () => {
    expect(normalizeKnowledgeArticle(article({ content: '  Keep this exact content  ' })).content).toBe('  Keep this exact content  ');
  });

  it('normalizes outer import fences without rewriting content or punctuation', () => {
    expect(normalizeKnowledgeArticle(article())).toEqual({
      sourceArticleId: 1,
      slug: 'founders',
      title: 'Who founded JAMA?',
      content: 'JAMA! was founded...',
      sourceUpdatedAt: '1792090615',
      position: 10,
    });
    expect(normalizeKnowledgeArticle(article({ content: '```markdown\nKeep *this* punctuation!\n```' })).content).toBe('Keep *this* punctuation!');
  });

  it('rejects an article whose normalized content is empty', () => {
    expect(() => normalizeKnowledgeArticle(article({ content: '```\n  \n```' }))).toThrow('chatwoot_knowledge_empty_content');
  });
});
