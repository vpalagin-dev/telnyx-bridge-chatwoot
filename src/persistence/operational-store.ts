import type {
  AiConversationState,
  AiDecisionRecord,
  AiDecisionStatus,
  AiOutcome,
} from '../ai/types.js';

export type Awaitable<T> = T | Promise<T>;
export type OperationalEventProvider = 'telnyx' | 'chatwoot';
export type OperationalEventStatus = 'processing' | 'completed' | 'unknown_needs_review';
export type OutboundActionStatus = 'submitting' | 'sent' | 'unknown_needs_review';
export type AiDecisionUnknownReason = 'chatwoot_history' | 'telnyx_submission' | 'rate_limit' | 'store';

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

/** Persistence-neutral contract; implementations may be synchronous or async during migration. */
export interface OperationalStore {
  claimEvent(provider: OperationalEventProvider, eventId: string): Awaitable<boolean>;
  getEventStatus(provider: OperationalEventProvider, eventId: string): Awaitable<OperationalEventStatus | null>;
  setEventStatus(provider: OperationalEventProvider, eventId: string, status: Exclude<OperationalEventStatus, 'processing'>): Awaitable<void>;

  suppress(phone: string, sourceEventId: string): Awaitable<void>;
  isSuppressed(phone: string): Awaitable<boolean>;

  bindConversation(conversationId: number, phone: string): Awaitable<void>;
  getPhoneForConversation(conversationId: number): Awaitable<string | null>;

  claimOutboundAction(actionId: string): Awaitable<boolean>;
  getOutboundAction(actionId: string): Awaitable<OutboundActionRecord | null>;
  completeOutboundAction(actionId: string, telnyxMessageId: string): Awaitable<void>;
  markOutboundUnknown(actionId: string): Awaitable<void>;

  isAiHistoryMessage(messageId: number | string): Awaitable<boolean>;
  ensureAiActive(conversationId: number): Awaitable<boolean>;
  claimAiDecision(input: AiDecisionClaimInput): Awaitable<AiDecisionClaimResult>;
  getAiDecision(identityOrDecisionId: string): Awaitable<AiDecisionRecord | null>;
  setAiDecisionOutcome(decisionId: string, outcome: AiDecisionOutcome): Awaitable<void>;
  recordAiHistoryMessage(decisionId: string, messageId: number): Awaitable<void>;
  markAiDecisionUnknown(decisionId: string, reason: AiDecisionUnknownReason): Awaitable<void>;
  recordAiTelnyxSubmission(decisionId: string, actionId: string, telnyxMessageId: string): Awaitable<void>;

  countAiRepliesSince(phone: string, cutoff: number): Awaitable<number>;
  getLastAiReplyAt(phone: string): Awaitable<number | null>;
  recordAiReply(phone: string, decisionId: string, sentAt: number): Awaitable<void>;
  claimAiReplyAttempt(
    phone: string,
    decisionId: string,
    now: number,
    debounceMs: number,
    limit: number,
    windowMs: number,
  ): Awaitable<AiReplyAttemptResult>;
}
