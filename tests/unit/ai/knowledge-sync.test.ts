import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChatwootHelpCenterClient, ChatwootKnowledgeArticle } from '../../../src/ai/chatwoot-knowledge.js';
import type { KnowledgeStore } from '../../../src/persistence/knowledge-store.js';
import { createKnowledgeSyncService } from '../../../src/ai/knowledge-sync.js';

const article = (overrides: Partial<ChatwootKnowledgeArticle> = {}): ChatwootKnowledgeArticle => ({
  id: 1,
  slug: 'founders',
  title: 'Who founded JAMA?',
  content: 'JAMA was founded...',
  status: 'published',
  updatedAt: '2026-10-15T00:00:00.000Z',
  position: 10,
  ...overrides,
});

function client(articles: ChatwootKnowledgeArticle[] | Error): ChatwootHelpCenterClient {
  return { listPublishedArticles: articles instanceof Error ? vi.fn().mockRejectedValue(articles) : vi.fn().mockResolvedValue(articles) };
}

function chatwootClientError(reason: string): ChatwootHelpCenterClient {
  return { listPublishedArticles: vi.fn().mockRejectedValue(new Error(reason)) };
}

function store(): KnowledgeStore & { activateChatwootSnapshot: ReturnType<typeof vi.fn> } {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    activateChatwootSnapshot: vi.fn().mockResolvedValue({ id: 'snapshot-1', profileId: 'jama', source: 'chatwoot', contentHash: 'hash', articleCount: 1, activatedAt: 'now' }),
    getActiveKnowledge: vi.fn().mockResolvedValue(null),
  };
}

describe('knowledge sync service', () => {
  it('uses a deterministic SHA-256 hash for identical normalized article lists', async () => {
    const firstStore = store();
    const secondStore = store();
    const options = { profileId: 'jama', intervalMs: 1000 };
    const first = createKnowledgeSyncService({ ...options, client: client([article(), article({ id: 2, slug: 'second', title: 'Second', position: 1 })]), store: firstStore });
    const second = createKnowledgeSyncService({ ...options, client: client([article({ id: 2, slug: 'second', title: 'Second', position: 1 }), article()]), store: secondStore });

    const firstResult = await first.syncOnce();
    const secondResult = await second.syncOnce();

    expect(firstResult.contentHash).toBe(secondResult.contentHash);
    expect(firstResult.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(firstResult.contentHash).toBe(createHash('sha256').update(JSON.stringify([
      { sourceArticleId: 2, slug: 'second', title: 'Second', content: 'JAMA was founded...', sourceUpdatedAt: '2026-10-15T00:00:00.000Z', position: 1 },
      { sourceArticleId: 1, slug: 'founders', title: 'Who founded JAMA?', content: 'JAMA was founded...', sourceUpdatedAt: '2026-10-15T00:00:00.000Z', position: 10 },
    ])).digest('hex'));
  });

  it('activates the first complete published article snapshot', async () => {
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({ client: client([article()]), store: knowledgeStore, profileId: 'jama', intervalMs: 1000 });

    await expect(service.syncOnce()).resolves.toMatchObject({ activated: true, articleCount: 1 });
    expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(1);
    expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledWith('jama', [expect.objectContaining({ sourceArticleId: 1 })], expect.any(String));
  });

  it('activates changed article content as a new snapshot', async () => {
    const knowledgeStore = store();
    const articles = vi.fn().mockResolvedValueOnce([article()]).mockResolvedValueOnce([article({ content: 'Changed content' })]);
    const service = createKnowledgeSyncService({ client: { listPublishedArticles: articles }, store: knowledgeStore, profileId: 'jama', intervalMs: 1000 });

    await service.syncOnce();
    await service.syncOnce();

    expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(2);
    expect(knowledgeStore.activateChatwootSnapshot.mock.calls[0]?.[2]).not.toBe(knowledgeStore.activateChatwootSnapshot.mock.calls[1]?.[2]);
  });

  it('does not activate when the client fails', async () => {
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({ client: client(new Error('token=secret')), store: knowledgeStore, profileId: 'jama', intervalMs: 1000 });

    await expect(service.syncOnce()).rejects.toThrow();
    expect(knowledgeStore.activateChatwootSnapshot).not.toHaveBeenCalled();
  });

  it('does not report activation when the store rejects', async () => {
    const knowledgeStore = store();
    knowledgeStore.activateChatwootSnapshot.mockRejectedValueOnce(new Error('raw-secret-token'));
    const service = createKnowledgeSyncService({ client: client([article()]), store: knowledgeStore, profileId: 'jama', intervalMs: 1000 });

    await expect(service.syncOnce()).rejects.toMatchObject({ code: 'knowledge_activation_failed' });
    expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(1);
  });

  it('normalizes numeric timestamps before hashing and activation', async () => {
    const numericStore = store();
    const isoStore = store();
    const numericService = createKnowledgeSyncService({ client: client([article({ updatedAt: 1792090615 })]), store: numericStore, profileId: 'jama', intervalMs: 1000 });
    const isoService = createKnowledgeSyncService({ client: client([article({ updatedAt: '2026-10-15T18:56:55.000Z' })]), store: isoStore, profileId: 'jama', intervalMs: 1000 });

    const numericResult = await numericService.syncOnce();
    const isoResult = await isoService.syncOnce();

    expect(numericResult.contentHash).toBe(isoResult.contentHash);
    expect(numericStore.activateChatwootSnapshot).toHaveBeenCalledWith(
      'jama',
      [expect.objectContaining({ sourceUpdatedAt: '2026-10-15T18:56:55.000Z' })],
      numericResult.contentHash,
    );
  });

  it('never logs article bodies, tokens, or raw secret-bearing errors', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({
      client: client(new Error('api_access_token=top-secret article-body=private')),
      store: knowledgeStore,
      profileId: 'jama',
      intervalMs: 1000,
      logger,
    });

    const handle = service.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    await handle.stop();

    const serialized = JSON.stringify([...logger.info.mock.calls, ...logger.error.mock.calls]);
    expect(serialized).not.toContain('top-secret');
    expect(serialized).not.toContain('private');
    expect(logger.error).toHaveBeenCalledWith(
      { code: 'knowledge_sync_failed', errorName: 'Error', errorCode: 'knowledge_fetch_failed' },
      'knowledge sync failed',
    );
  });

  it('includes a safe Chatwoot fetch reason without leaking secrets', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const service = createKnowledgeSyncService({
      client: chatwootClientError('chatwoot_knowledge_http_401'),
      store: store(),
      profileId: 'jama',
      intervalMs: 1000,
      logger,
    });

    const handle = service.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    await handle.stop();

    expect(logger.error).toHaveBeenCalledWith(
      {
        code: 'knowledge_sync_failed',
        errorName: 'Error',
        errorCode: 'knowledge_fetch_failed',
        stageReason: 'chatwoot_knowledge_http_401',
      },
      'knowledge sync failed',
    );
  });

  it('includes a safe stage code for activation failures without leaking the error message', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const knowledgeStore = store();
    knowledgeStore.activateChatwootSnapshot.mockRejectedValueOnce(Object.assign(new Error('postgres password=secret'), { code: '23505' }));
    const service = createKnowledgeSyncService({
      client: client([article()]),
      store: knowledgeStore,
      profileId: 'jama',
      intervalMs: 1000,
      logger,
    });

    const handle = service.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    await handle.stop();

    expect(logger.error).toHaveBeenCalledWith(
      { code: 'knowledge_sync_failed', errorName: 'Error', errorCode: 'knowledge_activation_failed' },
      'knowledge sync failed',
    );
    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).not.toContain('postgres password=secret');
    expect(serialized).not.toContain('secret');
  });

  it('logs a sanitized failure and continues scheduling after a failed attempt', async () => {
    let callback: (() => void) | undefined;
    const setTimeoutFn = vi.fn((fn: () => void, _delay?: number) => {
      callback = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const logger = { info: vi.fn(), error: vi.fn() };
    const knowledgeStore = store();
    const listPublishedArticles = vi.fn()
      .mockRejectedValueOnce(new Error('token=secret'))
      .mockResolvedValueOnce([article()]);
    const service = createKnowledgeSyncService({
      client: { listPublishedArticles },
      store: knowledgeStore,
      profileId: 'jama',
      intervalMs: 1000,
      logger,
      setTimeoutFn,
    });

    const handle = service.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    callback?.();
    await vi.waitFor(() => expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(1));
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ articleCount: 1, contentHash: expect.any(String) }), 'knowledge sync activated');
    await handle.stop();
  });

  it('accepts a complete empty published result', async () => {
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({ client: client([]), store: knowledgeStore, profileId: 'jama', intervalMs: 1000 });

    await expect(service.syncOnce()).resolves.toMatchObject({ activated: true, articleCount: 0 });
    expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledWith('jama', [], expect.any(String));
  });

  it('does not activate malformed articles', async () => {
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({ client: client([{ ...article(), content: '' }]), store: knowledgeStore, profileId: 'jama', intervalMs: 1000 });

    await expect(service.syncOnce()).rejects.toMatchObject({ code: 'knowledge_normalize_failed' });
    expect(knowledgeStore.activateChatwootSnapshot).not.toHaveBeenCalled();
  });

  it('logs a normalize stage code when article content is empty after normalization', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const service = createKnowledgeSyncService({
      client: client([article({ content: '```\n  \n```' })]),
      store: store(),
      profileId: 'jama',
      intervalMs: 1000,
      logger,
    });

    const handle = service.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    await handle.stop();

    expect(logger.error).toHaveBeenCalledWith(
      {
        code: 'knowledge_sync_failed',
        errorName: 'Error',
        errorCode: 'knowledge_normalize_failed',
        stageReason: 'chatwoot_knowledge_empty_content',
      },
      'knowledge sync failed',
    );
  });

  it('starts with an immediate sync and schedules the next attempt', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let callback: (() => void) | undefined;
    const setTimeoutFn = vi.fn((fn: () => void, _delay?: number) => { callback = fn; timer = 1 as unknown as ReturnType<typeof setTimeout>; return timer; }) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn();
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({ client: client([article()]), store: knowledgeStore, profileId: 'jama', intervalMs: 4321, setTimeoutFn, clearTimeoutFn });

    const handle = service.start();
    await vi.waitFor(() => expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(1));
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 4321);
    expect(timer).toBeDefined();
    callback?.();
    await vi.waitFor(() => expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(2));
    await handle.stop();
  });

  it('prevents overlap and stop awaits an active sync', async () => {
    let resolveSync!: (articles: ChatwootKnowledgeArticle[]) => void;
    const pending = new Promise<ChatwootKnowledgeArticle[]>((resolve) => { resolveSync = resolve; });
    const listPublishedArticles = vi.fn().mockReturnValue(pending);
    const setTimeoutFn = vi.fn((_fn: () => void, _delay?: number) => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn();
    const knowledgeStore = store();
    const service = createKnowledgeSyncService({ client: { listPublishedArticles }, store: knowledgeStore, profileId: 'jama', intervalMs: 1000, setTimeoutFn, clearTimeoutFn });
    const handle = service.start();
    await vi.waitFor(() => expect(listPublishedArticles).toHaveBeenCalledTimes(1));
    const stopPromise = handle.stop();
    let stopped = false;
    void stopPromise.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveSync([article()]);
    await stopPromise;
    expect(stopped).toBe(true);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(0);
    expect(listPublishedArticles).toHaveBeenCalledTimes(1);
  });

  it('can restart after stopping without creating overlapping loops', async () => {
    const knowledgeStore = store();
    const setTimeoutFn = vi.fn((_fn: () => void, _delay?: number) => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn();
    const service = createKnowledgeSyncService({ client: client([article()]), store: knowledgeStore, profileId: 'jama', intervalMs: 1000, setTimeoutFn, clearTimeoutFn });

    const first = service.start();
    await vi.waitFor(() => expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(1));
    await first.stop();
    service.start();
    await vi.waitFor(() => expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(2));
    await service.start().stop();
    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
  });

  it('does not create duplicate loops when started twice and repeated stop is safe', async () => {
    const knowledgeStore = store();
    const setTimeoutFn = vi.fn((_fn: () => void, _delay?: number) => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn();
    const service = createKnowledgeSyncService({ client: client([article()]), store: knowledgeStore, profileId: 'jama', intervalMs: 1000, setTimeoutFn, clearTimeoutFn });

    const first = service.start();
    const second = service.start();
    await vi.waitFor(() => expect(knowledgeStore.activateChatwootSnapshot).toHaveBeenCalledTimes(1));
    await Promise.all([first.stop(), second.stop(), second.stop()]);
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
  });
});

// Keep the test's client helper honest about accepted empty results.
void (client as unknown as (articles: ChatwootKnowledgeArticle[]) => ChatwootHelpCenterClient);
