import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeStore } from '../../../src/persistence/knowledge-store.js';
import { createKnowledgeProvider, MAX_RETRIEVED_CONTEXT_CHARS, MAX_RETRIEVED_DOCUMENTS } from '../../../src/ai/knowledge-provider.js';
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
        { sourceArticleId: 9, slug: 'system-prompt', title: 'System prompt', content: 'You are Ama.', sourceUpdatedAt: '2025-02-03T00:00:00.000Z', position: 0, categorySlug: 'system-prompt', kind: 'system_prompt' },
        { sourceArticleId: 2, slug: 'hours', title: 'Hours', content: 'Open 10-6.', sourceUpdatedAt: '2025-02-02T00:00:00.000Z', position: 2, categorySlug: 'hours', kind: 'factual' },
        { sourceArticleId: 1, slug: 'venue', title: 'Venue', content: 'At the park.', sourceUpdatedAt: '2025-02-01T00:00:00.000Z', position: 1, categorySlug: 'venue', kind: 'factual' },
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
      systemPrompt: 'You are Ama.',
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
      documents: [{ sourceArticleId: 1, slug: 'local', title: 'Local', content: 'Local content.', sourceUpdatedAt: '2025-02-01T00:00:00.000Z', position: 1, categorySlug: 'local', kind: 'factual' }],
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

  it('retrieves only matching factual documents and ranks title matches first', async () => {
    const store = storeWith({
      snapshot: { id: 'snapshot-2', profileId: 'profile', source: 'chatwoot', contentHash: 'hash', articleCount: 4, activatedAt: '2025-02-03T00:00:00.000Z' },
      documents: [
        { sourceArticleId: 1, slug: 'system', title: 'Prompt', content: 'You are helpful.', sourceUpdatedAt: '', position: 0, categorySlug: 'system-prompt', kind: 'system_prompt' },
        { sourceArticleId: 2, slug: 'refund-policy', title: 'Refund Policy', content: 'General ticket information.', sourceUpdatedAt: '', position: 2, categorySlug: 'refunds', kind: 'factual' },
        { sourceArticleId: 3, slug: 'tickets', title: 'Tickets', content: 'Refund policy details.', sourceUpdatedAt: '', position: 1, categorySlug: 'tickets', kind: 'factual' },
        { sourceArticleId: 4, slug: 'artist', title: 'Unrelated Artist', content: 'Music biography.', sourceUpdatedAt: '', position: 3, categorySlug: 'artist', kind: 'factual' },
      ],
    });
    const result = await createKnowledgeProvider({ source: 'chatwoot', profileId: 'profile', localRoot: '/unused', store }).load('event', 'refund policy');
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(result.eventMarkdown.indexOf('## Refund Policy')).toBeLessThan(result.eventMarkdown.indexOf('## Tickets'));
    expect(result.eventMarkdown).not.toContain('Unrelated Artist');
    expect(result.eventMarkdown).not.toContain('You are helpful.');
  });

  it('returns empty factual context for a lexical no-match', async () => {
    const store = storeWith({
      snapshot: { id: 'snapshot-3', profileId: 'profile', source: 'chatwoot', contentHash: 'hash', articleCount: 2, activatedAt: '2025-02-03T00:00:00.000Z' },
      documents: [
        { sourceArticleId: 1, slug: 'system', title: 'Prompt', content: 'Prompt.', sourceUpdatedAt: '', position: 0, categorySlug: 'system-prompt', kind: 'system_prompt' },
        { sourceArticleId: 2, slug: 'hours', title: 'Hours', content: 'Open daily.', sourceUpdatedAt: '', position: 1, categorySlug: 'hours', kind: 'factual' },
      ],
    });
    await expect(createKnowledgeProvider({ source: 'chatwoot', profileId: 'profile', localRoot: '/unused', store }).load('event', 'quantum banana')).resolves.toMatchObject({ eventMarkdown: '', systemPrompt: 'Prompt.' });
  });

  it('enforces document-count and combined-context caps', async () => {
    const documents = [
      { sourceArticleId: 1, slug: 'system', title: 'Prompt', content: 'Prompt.', sourceUpdatedAt: '', position: 0, categorySlug: 'system-prompt', kind: 'system_prompt' as const },
      ...Array.from({ length: MAX_RETRIEVED_DOCUMENTS + 2 }, (_, index) => ({
        sourceArticleId: index + 2, slug: `topic-${index}`, title: `Topic ${index}`, content: `refund ${'x'.repeat(2_000)}`, sourceUpdatedAt: '', position: index + 1, categorySlug: 'topic', kind: 'factual' as const,
      })),
    ];
    const store = storeWith({ snapshot: { id: 'snapshot-cap', profileId: 'profile', source: 'chatwoot', contentHash: 'hash', articleCount: documents.length, activatedAt: '' }, documents });
    const result = await createKnowledgeProvider({ source: 'chatwoot', profileId: 'profile', localRoot: '/unused', store }).load('event', 'refund');
    expect((result.eventMarkdown.match(/^## /gm) ?? []).length).toBeLessThanOrEqual(MAX_RETRIEVED_DOCUMENTS);
    expect(result.eventMarkdown.length).toBeLessThanOrEqual(MAX_RETRIEVED_CONTEXT_CHARS);
  });

  it('rejects an active Chatwoot snapshot without exactly one system prompt', async () => {
    const store = storeWith({
      snapshot: { id: 'snapshot-4', profileId: 'profile', source: 'chatwoot', contentHash: 'hash', articleCount: 1, activatedAt: '2025-02-03T00:00:00.000Z' },
      documents: [{ sourceArticleId: 2, slug: 'hours', title: 'Hours', content: 'Open daily.', sourceUpdatedAt: '', position: 1, categorySlug: 'hours', kind: 'factual' }],
    });
    await expect(createKnowledgeProvider({ source: 'chatwoot', profileId: 'profile', localRoot: '/unused', store }).load('event')).rejects.toThrow('chatwoot_knowledge_system_prompt_missing_or_ambiguous');
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
