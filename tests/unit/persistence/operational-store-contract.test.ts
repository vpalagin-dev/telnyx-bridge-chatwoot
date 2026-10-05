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
    async claimEvent(provider, eventId) {
      const key = `${provider}:${eventId}`;
      if (state.events.has(key)) return false;
      state.events.set(key, 'processing');
      return true;
    },
    async getEventStatus(provider, eventId) {
      return state.events.get(`${provider}:${eventId}`) ?? null;
    },
    async setEventStatus(provider, eventId, status) {
      state.events.set(`${provider}:${eventId}`, status);
    },
    async suppress(phone) {
      state.suppressed.add(phone);
    },
    async isSuppressed(phone) {
      return state.suppressed.has(phone);
    },
    async bindConversation(conversationId, phone) {
      state.conversations.set(conversationId, phone);
    },
    async getPhoneForConversation(conversationId) {
      return state.conversations.get(conversationId) ?? null;
    },
    async claimOutboundAction(actionId) {
      if (state.actions.has(actionId)) return false;
      state.actions.set(actionId, { status: 'submitting', telnyxMessageId: null });
      return true;
    },
    async getOutboundAction(actionId) {
      return state.actions.get(actionId) ?? null;
    },
    async completeOutboundAction(actionId, telnyxMessageId) {
      const action = state.actions.get(actionId);
      if (action) state.actions.set(actionId, { status: 'sent', telnyxMessageId });
    },
    async markOutboundUnknown(actionId) {
      const action = state.actions.get(actionId);
      if (action) state.actions.set(actionId, { ...action, status: 'unknown_needs_review' });
    },
    async isAiHistoryMessage(messageId) {
      return state.history.has(Number(messageId));
    },
    async ensureAiActive() {
      return true;
    },
    async claimAiDecision(input) {
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
    async getAiDecision(identityOrDecisionId) {
      return [...state.decisions.values()].find((decision) => decision.inboundIdentity === identityOrDecisionId || decision.aiDecisionId === identityOrDecisionId) ?? null;
    },
    async setAiDecisionOutcome() {},
    async recordAiHistoryMessage(decisionId, messageId) {
      state.history.add(messageId);
      const decision = [...state.decisions.values()].find((candidate) => candidate.aiDecisionId === decisionId);
      if (decision) decision.chatwootHistoryMessageId = messageId;
    },
    async markAiDecisionUnknown() {},
    async recordAiTelnyxSubmission() {},
    async countAiRepliesSince(phone, cutoff) {
      return (state.replies.get(phone) ?? []).filter((reply) => reply.sentAt >= cutoff).length;
    },
    async getLastAiReplyAt(phone) {
      const replies = state.replies.get(phone) ?? [];
      return replies.length ? Math.max(...replies.map((reply) => reply.sentAt)) : null;
    },
    async recordAiReply(phone, decisionId, sentAt) {
      state.replies.set(phone, [...(state.replies.get(phone) ?? []), { decisionId, sentAt }]);
    },
    async claimAiReplyAttempt(phone, decisionId, now, debounceMs, limit, windowMs) {
      if (await this.isSuppressed(phone)) return { allowed: false, reason: 'suppressed' };
      const last = await this.getLastAiReplyAt(phone);
      if (last !== null && now - last < debounceMs) return { allowed: false, reason: 'debounced', retryAt: last + debounceMs };
      if (await this.countAiRepliesSince(phone, now - windowMs) >= limit) return { allowed: false, reason: 'quota_exhausted' };
      await this.recordAiReply(phone, decisionId, now);
      return { allowed: true };
    },
  };
}

describe('OperationalStore contract', () => {
  it('deduplicates event, outbound action, and AI decision claims asynchronously', async () => {
    const store = fakeOperationalStore();
    expect(await store.claimEvent('telnyx', 'evt-1')).toBe(true);
    expect(await store.claimEvent('telnyx', 'evt-1')).toBe(false);
    expect(await store.claimOutboundAction('action-1')).toBe(true);
    expect(await store.claimOutboundAction('action-1')).toBe(false);
    const input = { inboundIdentity: 'msg-1', conversationId: 1, inboundMessageId: 2, eventId: 'evt-1', aiDecisionId: 'ai-1' };
    expect(await store.claimAiDecision(input)).toEqual({ claimed: true, decisionId: 'ai-1' });
    expect(await store.claimAiDecision(input)).toEqual({ claimed: false, decisionId: 'ai-1', status: 'claimed' });
  });

  it('denies suppressed and rate-limited AI replies asynchronously', async () => {
    const store = fakeOperationalStore();
    await store.suppress('+15550001', 'stop-1');
    const limiter = new AiReplyRateLimiter(store, { debounceMs: 100, limit: 1, windowMs: 1_000 });
    expect(await limiter.claim('+15550001', 'ai-1', 1_000)).toEqual({ allowed: false, reason: 'suppressed' });
    await store.recordAiReply('+15550002', 'ai-1', 1_000);
    expect(await limiter.claim('+15550002', 'ai-2', 1_050)).toEqual({ allowed: false, reason: 'debounced', retryAt: 1_100 });
    expect(await limiter.claim('+15550002', 'ai-3', 2_000)).toEqual({ allowed: false, reason: 'quota_exhausted' });
  });
});

type InboundStoreDependency = Parameters<typeof import('../../../src/inbound/process-inbound.js').processTelnyxInbound>[1]['store'];
type OutboundStoreDependency = Parameters<typeof import('../../../src/outbound/process-outbound.js').processChatwootOutbound>[1]['store'];
type AiStoreDependency = Parameters<typeof import('../../../src/ai/process-ai.js').processAiPostInbound>[1]['store'];
const pipelineStoreTypes: [OperationalStore extends InboundStoreDependency ? true : false, OperationalStore extends OutboundStoreDependency ? true : false, OperationalStore extends AiStoreDependency ? true : false] = [true, true, true];
void pipelineStoreTypes;
