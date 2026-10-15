import type { KnowledgeDocument } from '../ai/chatwoot-knowledge.js';

export type KnowledgeSnapshot = {
  id: string;
  profileId: string;
  source: 'chatwoot' | 'local';
  contentHash: string;
  articleCount: number;
  activatedAt: string;
};

export type ActiveKnowledge = {
  snapshot: KnowledgeSnapshot;
  documents: KnowledgeDocument[];
};

export interface KnowledgeStore {
  initialize(): Promise<void>;
  activateChatwootSnapshot(profileId: string, documents: KnowledgeDocument[], contentHash: string): Promise<KnowledgeSnapshot>;
  getActiveKnowledge(profileId: string): Promise<ActiveKnowledge | null>;
}
