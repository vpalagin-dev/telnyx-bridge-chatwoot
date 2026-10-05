import { afterEach, describe, expect, it } from 'vitest';
import { BridgeStore } from '../../../src/db/store.js';
import { FakeOpenAiAdapter } from '../../../src/ai/openai-fake.js';
import { FakeAiTelnyxDispatcher } from '../../../src/ai/telnyx-dispatch.js';
import { processAiPostInbound } from '../../../src/ai/process-ai.js';
import type { BridgeConfig } from '../../../src/config/env.js';
import type { ChatwootAiHistoryWriter } from '../../../src/ai/types.js';

class History implements ChatwootAiHistoryWriter {
  calls: Array<{ conversationId: number; text: string; metadata: unknown }> = [];
  async createAiHistoryMessage(conversationId: number, text: string, metadata: unknown) {
    this.calls.push({ conversationId, text, metadata });
    return { id: 500 + this.calls.length };
  }
}

const config: BridgeConfig = {
  environment: 'test',
  server: { host: '127.0.0.1', port: 1 },
  databasePath: ':memory:',
  persistence: { mode: 'sqlite', databaseUrl: undefined, redisUrl: undefined, redisPrefix: 'telnyx-bridge:' },
  runtimeRole: 'web',
  chatwoot: { url: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test' },
  telnyx: { apiKey: 'test', senderNumber: '+15551234567' },
  outbound: { mode: 'fake' },
  webhookToleranceSeconds: 300,
  ai: {
    enabled: true,
    providerMode: 'fake',
    liveOpenAiEnabled: false,
    model: 'gpt-4o-mini',
    maxInputTokens: 2048,
    maxOutputTokens: 256,
    timeoutMs: 5000,
    defaultEventId: 'event-afrorave-river',
    knowledgeRoot: 'specs/002-jama-ai-assistant-smoke/knowledge',
    safeFallbackText: 'Human help is on the way.',
    escalationEnabled: true,
    debounceMs: 0,
    replyLimit: 10,
    replyLimitWindowMs: 86_400_000,
  },
  aiOutbound: { liveSmsApproved: false, recipientAllowlist: [] },
};

const stores: BridgeStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function input(identity: string, inboundMessageId: number, text = 'Where is the venue?') {
  return {
    inboundIdentity: identity,
    telnyxEventId: `event-${identity}`,
    telnyxMessageId: identity,
    conversationId: 20,
    inboundMessageId,
    recipient: '+14155552671',
    customerMessage: text,
  };
}

describe('conversational AI policy', () => {
  it('allows a new inbound after a human reply without permanently disabling AI', async () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const history = new History();
    const telnyx = new FakeAiTelnyxDispatcher();
    const deps = {
      config,
      store,
      openai: new FakeOpenAiAdapter({ kind: 'answer', text: 'The demo venue is listed in approved knowledge.' }),
      history,
      telnyx,
    };

    store.transitionToHumanActive(20, 'human-message-1');
    const result = await processAiPostInbound(input('inbound-after-human', 31), deps);

    expect(result.outcome).toBe('answered');
    expect(telnyx.calls).toHaveLength(1);
  });

  it('answers a live smoke message when no knowledge-base event is configured', async () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const history = new History();
    const telnyx = new FakeAiTelnyxDispatcher();
    const { defaultEventId: _ignoredEventId, ...aiWithoutKnowledgeEvent } = config.ai!;
    const noKnowledgeConfig: BridgeConfig = { ...config, ai: aiWithoutKnowledgeEvent };
    const deps = {
      config: noKnowledgeConfig,
      store,
      openai: new FakeOpenAiAdapter({ kind: 'answer', text: 'I can help with that.' }),
      history,
      telnyx,
    };

    const result = await processAiPostInbound(input('inbound-without-knowledge', 33), deps);

    expect(result.outcome).toBe('answered');
    expect(history.calls).toHaveLength(1);
    expect(telnyx.calls).toHaveLength(1);
  });

  it('treats two distinct inbound messages with identical text as separate replies', async () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const history = new History();
    const telnyx = new FakeAiTelnyxDispatcher();
    const deps = {
      config,
      store,
      openai: new FakeOpenAiAdapter({ kind: 'answer', text: 'The demo venue is listed in approved knowledge.' }),
      history,
      telnyx,
    };

    await processAiPostInbound(input('inbound-1', 31), deps);
    await processAiPostInbound(input('inbound-2', 32), deps);

    expect(telnyx.calls).toHaveLength(2);
    expect(history.calls).toHaveLength(2);
  });
});
