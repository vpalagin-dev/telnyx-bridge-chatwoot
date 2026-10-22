export type BroadcastCampaign = {
  campaignId: string;
  title: string;
  message: string;
  inboxId: number;
  label: string | null;
  scheduledAt: Date;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
};

export type BroadcastLabel = { title: string };

export type ChatwootAudienceClient = {
  listLabels(): Promise<BroadcastLabel[]>;
  listRecipientPhones(options: { inboxId: number; label?: string | null }): Promise<string[]>;
};

export type BroadcastStore = {
  createCampaign(input: Omit<BroadcastCampaign, 'status' | 'sentCount' | 'skippedCount' | 'failedCount' | 'lastError'>): Promise<void>;
  claimDueCampaign(): Promise<BroadcastCampaign | null>;
  updateProgress(campaignId: string, patch: Partial<Pick<BroadcastCampaign, 'sentCount' | 'skippedCount' | 'failedCount' | 'lastError' | 'status'>> & { completed?: boolean }): Promise<void>;
};
