import type { ApprovedKnowledge, KnowledgeLoader } from './knowledge.js';
import { loadApprovedKnowledge } from './knowledge.js';
import type { KnowledgeDocument } from './chatwoot-knowledge.js';
import type { KnowledgeStore } from '../persistence/knowledge-store.js';

export type KnowledgeProvider = {
  load(eventId: string, query?: string): Promise<ApprovedKnowledge>;
};

export const MAX_RETRIEVED_DOCUMENTS = 5;
export const MAX_RETRIEVED_CONTEXT_CHARS = 8_000;

function lexicalTokens(value: string): string[] {
  return Array.from(value.normalize('NFKC').toLocaleLowerCase().matchAll(/[\p{L}\p{N}]+/gu), (match) => match[0]);
}

function documentScore(document: KnowledgeDocument, queryTokens: string[]): number {
  const titleTokens = new Set(lexicalTokens(`${document.title} ${document.slug}`));
  const contentTokens = lexicalTokens(document.content);
  return queryTokens.reduce((score, token) => {
    const titleMatches = titleTokens.has(token) ? 1 : 0;
    const contentMatches = contentTokens.reduce((count, candidate) => count + (candidate === token ? 1 : 0), 0);
    return score + titleMatches * 10 + contentMatches;
  }, 0);
}

function sortDocuments(documents: KnowledgeDocument[]): KnowledgeDocument[] {
  return [...documents].sort((left, right) => left.position - right.position || left.sourceArticleId - right.sourceArticleId);
}

function factualContext(documents: KnowledgeDocument[], query: string | undefined): string {
  const factual = documents.filter((document) => document.kind === 'factual');
  const queryTokens = query === undefined ? [] : lexicalTokens(query);
  const ranked = query === undefined
    ? sortDocuments(factual)
    : queryTokens.length === 0
      ? []
      : factual
        .map((document) => ({ document, score: documentScore(document, queryTokens) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.document.position - right.document.position || left.document.sourceArticleId - right.document.sourceArticleId)
        .map((entry) => entry.document);

  const selected: string[] = [];
  let totalLength = 0;
  for (const document of ranked.slice(0, MAX_RETRIEVED_DOCUMENTS)) {
    const rendered = `## ${document.title}\n\n${document.content}`;
    const nextLength = totalLength + (selected.length > 0 ? 2 : 0) + rendered.length;
    if (nextLength > MAX_RETRIEVED_CONTEXT_CHARS) continue;
    selected.push(rendered);
    totalLength = nextLength;
  }
  return selected.join('\n\n');
}

export function createKnowledgeProvider(options: {
  source: 'chatwoot' | 'local';
  profileId: string;
  localRoot: string;
  localLoader?: KnowledgeLoader;
  store?: KnowledgeStore;
}): KnowledgeProvider {
  const localLoader = options.localLoader ?? loadApprovedKnowledge;
  return {
    async load(eventId: string, query?: string): Promise<ApprovedKnowledge> {
      if (options.source === 'local') return localLoader(options.localRoot, eventId);
      const active = options.store ? await options.store.getActiveKnowledge(options.profileId) : null;
      if (!active || active.snapshot.source !== 'chatwoot') return localLoader(options.localRoot, eventId);
      const prompts = active.documents.filter((document) => document.kind === 'system_prompt');
      if (prompts.length !== 1) throw new Error('chatwoot_knowledge_system_prompt_missing_or_ambiguous');
      const prompt = prompts[0]!;
      return {
        eventId,
        event: { status: 'active', effective_from: active.snapshot.activatedAt, review_by: '' },
        eventMarkdown: factualContext(active.documents, query),
        sharedMarkdown: '',
        systemPrompt: prompt.content,
      };
    },
  };
}
