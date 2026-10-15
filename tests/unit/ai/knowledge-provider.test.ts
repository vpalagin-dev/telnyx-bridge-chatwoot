import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeStore } from '../../../src/persistence/knowledge-store.js';
import { createKnowledgeProvider } from '../../../src/ai/knowledge-provider.js';
import type { ApprovedKnowledge } from '../../../src/ai/knowledge.js';

const localKnowledge: ApprovedKnowledge = {
  eventId: 'jama-ama-v1.3',
  event: { status: 'confirmed', effective_from: '2025-01-01', review_by: '2025-12-31' },
  eventMarkdown: 'local confirmed knowledge',
  sharedMarkdown: '',
};

function storeWith(active: Awaited<ReturnType<KnowledgeStore['getActiveKnowledge']>>): KnowledgeStore {
  return {
    initialize: vi.fn(async () => undefined),
    activateChatwootSnapshot: vi.fn(async () => { throw new Error('not used'); }),
    getActiveKnowledge: vi.fn(async () => active),
  };
}

describe('createKnowledgeProvider', () => {
  it('returns active Chatwoot snapshot documents in ApprovedKnowledge shape without reading local files', async () => {
    const store = storeWith({
      snapshot: {
        id: 'snapshot-1', profileId: 'jama-help-center', source: 'chatwoot', contentHash: 'hash', articleCount: 2,
        activatedAt: '2025-02-03T04:05:06.000Z',
      },
      documents: [
        { sourceArticleId: 2, slug: 'hours', title: 'Hours', content: 'Open 10-6.', sourceUpdatedAt: '2025-02-02T00:00:00.000Z', position: 2 },
        { sourceArticleId: 1, slug: 'venue', title: 'Venue', content: 'At the park.', sourceUpdatedAt: '2025-02-01T00:00:00.000Z', position: 1 },
      ],
    });
    const localLoader = vi.fn(async () => { throw new Error('local files must not be read'); });

    const result = await createKnowledgeProvider({
      source: 'chatwoot', profileId: 'jama-help-center', localRoot: 'does-not-exist', localLoader, store,
    }).load('jama-ama-v1.3');

    expect(result).toEqual({
      eventId: 'jama-ama-v1.3',
      event: { status: 'active', effective_from: '2025-02-03T04:05:06.000Z', review_by: '' },
      eventMarkdown: '## Venue\n\nAt the park.\n\n## Hours\n\nOpen 10-6.',
      sharedMarkdown: '',
    });
    expect(store.getActiveKnowledge).toHaveBeenCalledWith('jama-help-center');
    expect(localLoader).not.toHaveBeenCalled();
  });

  it('falls back to the local loader when the active snapshot is local', async () => {
    const store = storeWith({
      snapshot: {
        id: 'snapshot-local', profileId: 'jama-help-center', source: 'local', contentHash: 'hash', articleCount: 1,
        activatedAt: '2025-02-03T04:05:06.000Z',
      },
      documents: [{ sourceArticleId: 1, slug: 'local', title: 'Local', content: 'Local content.', sourceUpdatedAt: '2025-02-01T00:00:00.000Z', position: 1 }],
    });
    const localLoader = vi.fn(async () => localKnowledge);

    const result = await createKnowledgeProvider({
      source: 'chatwoot', profileId: 'jama-help-center', localRoot: '/knowledge', localLoader, store,
    }).load('jama-ama-v1.3');

    expect(result).toBe(localKnowledge);
    expect(localLoader).toHaveBeenCalledWith('/knowledge', 'jama-ama-v1.3');
  });

  it('falls back to the local loader only when Chatwoot has no active snapshot', async () => {
    const store = storeWith(null);
    const localLoader = vi.fn(async () => localKnowledge);

    const result = await createKnowledgeProvider({
      source: 'chatwoot', profileId: 'jama-help-center', localRoot: '/knowledge', localLoader, store,
    }).load('jama-ama-v1.3');

    expect(result).toBe(localKnowledge);
    expect(localLoader).toHaveBeenCalledWith('/knowledge', 'jama-ama-v1.3');
  });

  it('uses only the local loader in local mode', async () => {
    const store = storeWith(null);
    const localLoader = vi.fn(async () => localKnowledge);

    const result = await createKnowledgeProvider({
      source: 'local', profileId: 'jama-help-center', localRoot: '/knowledge', localLoader, store,
    }).load('jama-ama-v1.3');

    expect(result).toBe(localKnowledge);
    expect(localLoader).toHaveBeenCalledWith('/knowledge', 'jama-ama-v1.3');
    expect(store.getActiveKnowledge).not.toHaveBeenCalled();
  });
});
