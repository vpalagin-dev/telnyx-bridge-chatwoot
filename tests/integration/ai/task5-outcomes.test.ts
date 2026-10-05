import { describe, expect, it } from 'vitest';
import { FakeOperationalStore } from '../../helpers/fake-operational-store.js';
import { FakeOpenAiAdapter } from '../../../src/ai/openai-fake.js';
import { FakeAiTelnyxDispatcher } from '../../../src/ai/telnyx-dispatch.js';
import { processAiPostInbound } from '../../../src/ai/process-ai.js';
import type { BridgeConfig } from '../../../src/config/env.js';
import type { ChatwootAiHistoryWriter, PostInboundAiInput } from '../../../src/ai/types.js';

const config: BridgeConfig = {
  environment: 'test', server: { host: '127.0.0.1', port: 1 }, databaseUrl: 'postgresql://test-only',
  persistence: { redisUrl: undefined, redisPrefix: 'telnyx-bridge:' }, runtimeRole: 'web',
  chatwoot: { url: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test' },
  telnyx: { apiKey: 'test', senderNumber: '+15551234567' }, outbound: { mode: 'fake' }, webhookToleranceSeconds: 300,
  ai: { enabled: true, providerMode: 'fake', liveOpenAiEnabled: false, model: 'gpt-4o-mini', maxInputTokens: 2048,
    maxOutputTokens: 256, timeoutMs: 5000, defaultEventId: 'event-afrorave-river', knowledgeRoot: 'specs/002-jama-ai-assistant-smoke/knowledge',
    safeFallbackText: 'Human help is on the way.', escalationEnabled: true, debounceMs: 0, replyLimit: 10, replyLimitWindowMs: 86400000 },
  aiOutbound: { liveSmsApproved: false, recipientAllowlist: [] },
};

class History implements ChatwootAiHistoryWriter {
  async createAiHistoryMessage(): Promise<{ id: number }> { return { id: 501 }; }
}

const inbound = (id: string): PostInboundAiInput => ({
  inboundIdentity: id, telnyxEventId: `event-${id}`, telnyxMessageId: id, conversationId: 7,
  inboundMessageId: 8, recipient: '+14155552671', customerMessage: 'Where is the venue?',
});

describe('Task 5 durable AI outcomes', () => {
  it('persists answered outcome, completed status, state, and provider IDs', async () => {
    const store = new FakeOperationalStore(':memory:');
    const result = await processAiPostInbound(inbound('answered-1'), {
      config, store, openai: new FakeOpenAiAdapter({ kind: 'answer', text: 'At the venue.' }),
      history: new History(), telnyx: new FakeAiTelnyxDispatcher(),
    });
    const decision = store.getAiDecision('answered-1');
    expect(result.outcome).toBe('answered');
    expect(decision).toMatchObject({ outcome: 'answered', status: 'completed', state: 'ai_active', chatwootHistoryMessageId: 501 });
    expect(decision?.telnyxActionId).toBeTruthy();
    expect(decision?.telnyxMessageId).toBeTruthy();
  });
});

it('projects an unknown outcome and waiting_for_human when history fails', async () => {
  const store = new FakeOperationalStore(':memory:');
  const history: ChatwootAiHistoryWriter = { async createAiHistoryMessage() { throw new Error('history down'); } };
  const result = await processAiPostInbound(inbound('history-fail-1'), {
    config, store, openai: new FakeOpenAiAdapter({ kind: 'answer', text: 'At the venue.' }), history,
    telnyx: new FakeAiTelnyxDispatcher(),
  });
  expect(result).toMatchObject({ outcome: 'unknown_needs_review', state: 'waiting_for_human' });
  expect(store.getAiDecision('history-fail-1')).toMatchObject({ outcome: 'unknown_needs_review', status: 'unknown_needs_review', state: 'waiting_for_human', unknownReason: 'chatwoot_history' });
});

it('does not downgrade an unknown decision after a late success', async () => {
  const store = new FakeOperationalStore(':memory:');
  await processAiPostInbound(inbound('late-success-1'), {
    config, store, openai: new FakeOpenAiAdapter({ kind: 'answer', text: 'At the venue.' }),
    history: new History(), telnyx: new FakeAiTelnyxDispatcher(),
  });
  await store.markAiDecisionUnknown('ai-late-success-1', 'telnyx_submission');
  await store.setAiDecisionOutcome('ai-late-success-1', { outcome: 'answered', status: 'completed', state: 'ai_active' });
  expect(store.getAiDecision('late-success-1')).toMatchObject({ outcome: 'unknown_needs_review', status: 'unknown_needs_review', state: 'waiting_for_human' });
});
