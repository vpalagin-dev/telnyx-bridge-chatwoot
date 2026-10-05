import type {
  AiConversationState,
  AiDecisionRecord,
  AiDecisionStatus,
  AiOutcome,
} from '../ai/types.js';

export type OperationalEventProvider = 'telnyx' | 'chatwoot';
export type OperationalEventStatus = 'processing' | 'completed' | 'unknown_needs_review';
export type OutboundActionStatus = 'submitting' | 'sent' | 'unknown_needs_review';

export type OutboundActionRecord = {
  status: OutboundActionStatus;
  telnyxMessageId: string | null;
};

export type AiDecisionClaimInput = {
  inboundIdentity: string;
  conversationId: number;
  inboundMessageId: number;
  eventId: string;
  aiDecisionId: string;
};

export type AiDecisionClaimResult =
  | { claimed: true; decisionId: string }
  | { claimed: false; decisionId: string; status: AiDecisionStatus };

export type AiDecisionOutcome = {
  outcome: AiOutcome;
  status: AiDecisionStatus;
  state: AiConversationState;
};

export type AiReplyAttemptResult =
  | { allowed: true }
  | { allowed: false; reason: 'suppressed' | 'debounced' | 'quota_exhausted'; retryAt?: number };

/** Persistence-neutral contract for the operational state used by message pipelines. */
export interface OperationalStore {
  claimEvent(provider: OperationalEventProvider, eventId: string): boolean;
  getEventStatus(provider: OperationalEventProvider, eventId: string): OperationalEventStatus | null;
  setEventStatus(provider: OperationalEventProvider, eventId: string, status: Exclude<OperationalEventStatus, 'processing'>): void;

  suppress(phone: string, sourceEventId: string): void;
  isSuppressed(phone: string): boolean;

  bindConversation(conversationId: number, phone: string): void;
  getPhoneForConversation(conversationId: number): string | null;

  claimOutboundAction(actionId: string): boolean;
  getOutboundAction(actionId: string): OutboundActionRecord | null;
  completeOutboundAction(actionId: string, telnyxMessageId: string): void;
  markOutboundUnknown(actionId: string): void;

  isAiHistoryMessage(messageId: number | string): boolean;
  ensureAiActive(conversationId: number): void;
  claimAiDecision(input: AiDecisionClaimInput): AiDecisionClaimResult;
  getAiDecision(identityOrDecisionId: string): AiDecisionRecord | null;
  setAiDecisionOutcome(decisionId: string, outcome: AiDecisionOutcome): void;
  recordAiHistoryMessage(decisionId: string, messageId: number): void;
  markAiDecisionUnknown(decisionId: string, reason: string): void;
  recordAiTelnyxSubmission(decisionId: string, actionId: string, telnyxMessageId: string): void;

  countAiRepliesSince(phone: string, cutoff: number): number;
  getLastAiReplyAt(phone: string): number | null;
  recordAiReply(phone: string, decisionId: string, sentAt: number): void;
  claimAiReplyAttempt(
    phone: string,
    decisionId: string,
    now: number,
    debounceMs: number,
    limit: number,
    windowMs: number,
  ): AiReplyAttemptResult;
}
