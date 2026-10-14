import { afterEach, describe, expect, it } from 'vitest';
import { processAiPostInbound } from '../../../src/ai/process-ai.js';
import { FakeOpenAiAdapter } from '../../../src/ai/openai-fake.js';
import { FakeAiTelnyxDispatcher } from '../../../src/ai/telnyx-dispatch.js';
import type { BridgeConfig } from '../../../src/config/env.js';
import type { ChatwootAiHistoryWriter } from '../../../src/ai/types.js';
import { FakeOperationalStore } from '../../helpers/fake-operational-store.js';

class History implements ChatwootAiHistoryWriter {
  calls: Array<{ text: string }> = [];
  async createAiHistoryMessage(_conversationId: number, text: string) {
    this.calls.push({ text });
    return { id: 501 };
  }
}

const config: BridgeConfig = {
  environment: 'test',
  server: { host: '127.0.0.1', port: 1 },
  databaseUrl: 'postgresql://test-only',
  persistence: { redisUrl: undefined, redisPrefix: 'telnyx-bridge:' },
  runtimeRole: 'worker',
  chatwoot: { url: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'x' },
  telnyx: { apiKey: 'x', senderNumber: '+15551234567' },
  outbound: { mode: 'fake' },
  webhookToleranceSeconds: 300,
  ai: {
    enabled: true,
    providerMode: 'fake',
    liveOpenAiEnabled: false,
    model: 'gpt-4o-mini',
    maxInputTokens: 2048,
    maxOutputTokens: 40,
    timeoutMs: 5000,
    knowledgeRoot: 'specs/002-jama-ai-assistant-smoke/knowledge',
    safeFallbackText: 'Sorry, this message is outside the supported topics. Please ask another question.',
    escalationEnabled: true,
  },
  aiOutbound: { liveSmsApproved: false, recipientAllowlist: [] },
};

describe('AI fallback SMS', () => {
  const stores: FakeOperationalStore[] = [];
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it('sends one safe fallback SMS when the AI answer fails validation', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const telnyx = new FakeAiTelnyxDispatcher();
    const history = new History();

    const result = await processAiPostInbound({
      inboundIdentity: 'fallback-message-1',
      telnyxEventId: 'fallback-event-1',
      telnyxMessageId: 'fallback-message-1',
      conversationId: 20,
      inboundMessageId: 30,
      recipient: '+14155552671',
      customerMessage: 'Hi',
    }, {
      config,
      store,
      openai: new FakeOpenAiAdapter({ kind: 'answer', text: '[invalid response]' }),
      history,
      telnyx,
    });

    expect(result).toMatchObject({ outcome: 'fallback', state: 'waiting_for_human' });
    expect(telnyx.calls).toHaveLength(1);
    expect(telnyx.calls[0]?.text).toBe(config.ai?.safeFallbackText);
    expect(history.calls[0]?.text).toBe(config.ai?.safeFallbackText);
  });
});
