import type { ApprovedKnowledge, KnowledgeLoader, } from './knowledge.js';
import { loadApprovedKnowledge } from './knowledge.js';
import type { KnowledgeStore } from '../persistence/knowledge-store.js';

export type KnowledgeProvider = {
  load(profileId: string): Promise<ApprovedKnowledge>;
};

export function createKnowledgeProvider(options: {
  source: 'chatwoot' | 'local';
  profileId: string;
  localRoot: string;
  localLoader?: KnowledgeLoader;
  store?: KnowledgeStore;
}): KnowledgeProvider {
  const localLoader = options.localLoader ?? loadApprovedKnowledge;
  return {
    async load(eventId: string): Promise<ApprovedKnowledge> {
      if (options.source === 'local') return localLoader(options.localRoot, eventId);
      const active = options.store ? await options.store.getActiveKnowledge(options.profileId) : null;
      if (!active) return localLoader(options.localRoot, eventId);
      const documents = [...active.documents].sort((left, right) => left.position - right.position || left.sourceArticleId - right.sourceArticleId);
      return {
        eventId,
        event: { status: 'active', effective_from: active.snapshot.activatedAt, review_by: '' },
        eventMarkdown: documents.map((document) => `## ${document.title}\n\n${document.content}`).join('\n\n'),
        sharedMarkdown: '',
      };
    },
  };
}
