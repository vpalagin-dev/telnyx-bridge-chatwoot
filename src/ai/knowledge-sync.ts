import { createHash } from 'node:crypto';
import {
  normalizeKnowledgeArticle,
  type ChatwootHelpCenterClient,
  type KnowledgeDocument,
} from './chatwoot-knowledge.js';
import type { KnowledgeStore } from '../persistence/knowledge-store.js';

export type KnowledgeSyncHandle = { stop(): Promise<void>; ready: Promise<void> };

export type KnowledgeSyncService = {
  syncOnce(): Promise<{ activated: boolean; articleCount: number; contentHash: string }>;
  start(): KnowledgeSyncHandle;
};

type Logger = {
  info(data: object, message: string): void;
  error(data: object, message: string): void;
};

type Timer = ReturnType<typeof setTimeout>;

const defaultLogger: Logger = {
  info: () => undefined,
  error: () => undefined,
};

function stableDocuments(documents: KnowledgeDocument[]): KnowledgeDocument[] {
  return [...documents].sort((left, right) => left.position - right.position || left.sourceArticleId - right.sourceArticleId);
}

function hashDocuments(documents: KnowledgeDocument[]): string {
  const stable = stableDocuments(documents).map((document) => ({
    sourceArticleId: document.sourceArticleId,
    slug: document.slug,
    title: document.title,
    content: document.content,
    sourceUpdatedAt: document.sourceUpdatedAt,
    position: document.position,
  }));
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex');
}

export function createKnowledgeSyncService(options: {
  client: ChatwootHelpCenterClient;
  store: KnowledgeStore;
  profileId: string;
  intervalMs: number;
  logger?: Logger;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): KnowledgeSyncService {
  const logger = options.logger ?? defaultLogger;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let started = false;
  let timer: Timer | undefined;
  let running: Promise<void> | undefined;
  let handle: KnowledgeSyncHandle | undefined;

  async function syncOnce(): Promise<{ activated: boolean; articleCount: number; contentHash: string }> {
    const articles = await options.client.listPublishedArticles();
    const documents = stableDocuments(articles.map(normalizeKnowledgeArticle));
    const contentHash = hashDocuments(documents);
    await options.store.activateChatwootSnapshot(options.profileId, documents, contentHash);
    return { activated: true, articleCount: documents.length, contentHash };
  }

  function schedule(): void {
    if (!started || timer !== undefined) return;
    timer = setTimeoutFn(() => {
      timer = undefined;
      void runAttempt();
    }, options.intervalMs);
  }

  async function runAttempt(): Promise<void> {
    if (!started || running !== undefined) return;
    running = syncOnce()
      .then((result) => {
        logger.info({ articleCount: result.articleCount, contentHash: result.contentHash }, 'knowledge sync activated');
      })
      .catch(() => {
        logger.error({ code: 'knowledge_sync_failed' }, 'knowledge sync failed');
      })
      .then(() => undefined);
    try {
      await running;
    } finally {
      running = undefined;
      schedule();
    }
  }

  async function stop(): Promise<void> {
    started = false;
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      timer = undefined;
    }
    if (running !== undefined) await running;
    handle = undefined;
  }

  return {
    syncOnce,
    start(): KnowledgeSyncHandle {
      if (handle !== undefined) return handle;
      started = true;
      const ready = runAttempt();
      handle = { stop, ready };
      return handle;
    },
  };
}
