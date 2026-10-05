import { describe, expect, it } from 'vitest';
import type { OperationalStore } from '../../../src/persistence/operational-store.js';
import { AiReplyRateLimiter } from '../../../src/ai/rate-limit.js';
import type { AiDecisionRecord } from '../../../src/ai/types.js';

type EventStatus = 'processing' | 'completed' | 'unknown_needs_review';

type FakeState = {
  events: Map<string, EventStatus>;
  actions: Map<string, { status: 'submitting' | 'sent' | 'unknown_needs_review'; telnyxMessageId: string | null }>;
  suppressed: Set<string>;
  conversations: Map<number, string>;
  decisions: Map<string, AiDecisionRecord>;
  history: Set<number>;
  replies: Map<string, Array<{ decisionId: string; sentAt: number }>>;
};

function fakeOperationalStore(): OperationalStore {
  const state: FakeState = {
    events: new Map(),
    actions: new Map(),
    suppressed: new Set(),
    conversations: new Map(),
    decisions: new Map(),
    history: new Set(),
    replies: new Map(),
  };

  return {
    claimEvent(provider, eventId) {
      const key = `${provider}:${eventId}`;
      if (state.events.has(key)) return false;
      state.events.set(key, 'processing');
      return true;
    },
    getEventStatus(provider, eventId) {
      return state.events.get(`${provider}:${eventId}`) ?? null;
    },
    setEventStatus(provider, eventId, status) {
      state.events.set(`${provider}:${eventId}`, status);
    },
    suppress(phone) {
      state.suppressed.add(phone);
    },
    isSuppressed(phone) {
      return state.suppressed.has(phone);
    },
    bindConversation(conversationId, phone) {
      state.conversations.set(conversationId, phone);
    },
    getPhoneForConversation(conversationId) {
      return state.conversations.get(conversationId) ?? null;
    },
    claimOutboundAction(actionId) {
      if (state.actions.has(actionId)) return false;
      state.actions.set(actionId, { status: 'submitting', telnyxMessageId: null });
      return true;
    },
    getOutboundAction(actionId) {
      return state.actions.get(actionId) ?? null;
    },
    completeOutboundAction(actionId, telnyxMessageId) {
      const action = state.actions.get(actionId);
      if (action) state.actions.set(actionId, { status: 'sent', telnyxMessageId });
    },
    markOutboundUnknown(actionId) {
      const action = state.actions.get(actionId);
      if (action) state.actions.set(actionId, { ...action, status: 'unknown_needs_review' });
    },
    isAiHistoryMessage(messageId) {
      return state.history.has(Number(messageId));
    },
    ensureAiActive() {},
    claimAiDecision(input) {
      const previous = state.decisions.get(input.inboundIdentity);
      if (previous) return { claimed: false, decisionId: previous.aiDecisionId, status: previous.status };
      const decision: AiDecisionRecord = {
        ...input,
        chatwootHistoryMessageId: null,
        telnyxActionId: null,
        telnyxMessageId: null,
        outcome: 'provider_error',
        status: 'claimed',
        state: 'ai_active',
        model: null,
        createdAt: 'now',
        updatedAt: 'now',
        unknownReason: null,
      };
      state.decisions.set(input.inboundIdentity, decision);
      return { claimed: true, decisionId: input.aiDecisionId };
    },
    getAiDecision(identityOrDecisionId) {
      return [...state.decisions.values()].find((decision) => decision.inboundIdentity === identityOrDecisionId || decision.aiDecisionId === identityOrDecisionId) ?? null;
    },
    setAiDecisionOutcome() {},
    recordAiHistoryMessage(decisionId, messageId) {
      state.history.add(messageId);
      const decision = [...state.decisions.values()].find((candidate) => candidate.aiDecisionId === decisionId);
      if (decision) decision.chatwootHistoryMessageId = messageId;
    },
    markAiDecisionUnknown() {},
    recordAiTelnyxSubmission() {},
    countAiRepliesSince(phone, cutoff) {
      return (state.replies.get(phone) ?? []).filter((reply) => reply.sentAt >= cutoff).length;
    },
    getLastAiReplyAt(phone) {
      const replies = state.replies.get(phone) ?? [];
      return replies.length ? Math.max(...replies.map((reply) => reply.sentAt)) : null;
    },
    recordAiReply(phone, decisionId, sentAt) {
      state.replies.set(phone, [...(state.replies.get(phone) ?? []), { decisionId, sentAt }]);
    },
    claimAiReplyAttempt(phone, decisionId, now, debounceMs, limit, windowMs) {
      if (state.suppressed.has(phone)) return { allowed: false, reason: 'suppressed' };
      const last = this.getLastAiReplyAt(phone);
      if (last !== null && now - last < debounceMs) return { allowed: false, reason: 'debounced', retryAt: last + debounceMs };
      if (this.countAiRepliesSince(phone, now - windowMs) >= limit) return { allowed: false, reason: 'quota_exhausted' };
      this.recordAiReply(phone, decisionId, now);
      return { allowed: true };
    },
  };
}

describe('OperationalStore contract', () => {
  it('deduplicates event, outbound action, and AI decision claims', () => {
    const store = fakeOperationalStore();
    expect(store.claimEvent('telnyx', 'evt-1')).toBe(true);
    expect(store.claimEvent('telnyx', 'evt-1')).toBe(false);
    expect(store.claimOutboundAction('action-1')).toBe(true);
    expect(store.claimOutboundAction('action-1')).toBe(false);
    const input = { inboundIdentity: 'msg-1', conversationId: 1, inboundMessageId: 2, eventId: 'evt-1', aiDecisionId: 'ai-1' };
    expect(store.claimAiDecision(input)).toEqual({ claimed: true, decisionId: 'ai-1' });
    expect(store.claimAiDecision(input)).toEqual({ claimed: false, decisionId: 'ai-1', status: 'claimed' });
  });

  it('denies suppressed and rate-limited AI replies', () => {
    const store = fakeOperationalStore();
    store.suppress('+15550001', 'stop-1');
    const limiter = new AiReplyRateLimiter(store, { debounceMs: 100, limit: 1, windowMs: 1_000 });
    expect(limiter.claim('+15550001', 'ai-1', 1_000)).toEqual({ allowed: false, reason: 'suppressed' });
    store.recordAiReply('+15550002', 'ai-1', 1_000);
    expect(limiter.claim('+15550002', 'ai-2', 1_050)).toEqual({ allowed: false, reason: 'debounced', retryAt: 1_100 });
    expect(limiter.claim('+15550002', 'ai-3', 2_000)).toEqual({ allowed: false, reason: 'quota_exhausted' });
  });
});


type InboundStoreDependency = Parameters<typeof import('../../../src/inbound/process-inbound.js').processTelnyxInbound>[1]['store'];
type OutboundStoreDependency = Parameters<typeof import('../../../src/outbound/process-outbound.js').processChatwootOutbound>[1]['store'];
type AiStoreDependency = Parameters<typeof import('../../../src/ai/process-ai.js').processAiPostInbound>[1]['store'];
const pipelineStoreTypes: [OperationalStore extends InboundStoreDependency ? true : false, OperationalStore extends OutboundStoreDependency ? true : false, OperationalStore extends AiStoreDependency ? true : false] = [true, true, true];
void pipelineStoreTypes;

