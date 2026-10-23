import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeOperationalStore } from '../../helpers/fake-operational-store.js';
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
  databaseUrl: 'postgresql://test-only',
  persistence: { redisUrl: undefined, redisPrefix: 'telnyx-bridge:' },
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
    knowledgeRoot: 'specs/002-jama-ai-assistant-smoke/knowledge',
    safeFallbackText: 'Human help is on the way.',
    escalationEnabled: true,
    debounceMs: 0,
    replyLimit: 10,
    replyLimitWindowMs: 86_400_000,
  },
  aiOutbound: { liveSmsApproved: false, recipientAllowlist: [] },
};

const stores: FakeOperationalStore[] = [];
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
    const store = new FakeOperationalStore(':memory:');
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
    const store = new FakeOperationalStore(':memory:');
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

  it('passes recent Chatwoot messages to OpenAI as conversation turns', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const history = new History();
    const telnyx = new FakeAiTelnyxDispatcher();
    let conversationTurns: unknown;
    const openai = {
      async generate(request: { conversationTurns?: unknown }) {
        conversationTurns = request.conversationTurns;
        return { kind: 'answer' as const, text: 'Wear something comfortable.' };
      },
    };
    const deps = {
      config: { ...config, ai: { ...config.ai!, knowledgeSource: 'chatwoot' as const } },
      store,
      openai,
      history,
      telnyx,
      conversationHistory: {
        listConversationMessages: vi.fn(async () => ([
          { id: 30, content: 'I am coming with my sister', messageType: 'incoming' as const, private: false, createdAt: 1 },
          { id: 31, content: 'Nice!', messageType: 'outgoing' as const, private: false, createdAt: 2 },
        ])),
      },
    };

    const result = await processAiPostInbound(
      { ...input('inbound-history', 36), inboundMessageId: 99, customerMessage: 'What should we wear?' },
      deps,
    );

    expect(result.outcome).toBe('answered');
    expect(conversationTurns).toEqual([
      { role: 'user', content: 'I am coming with my sister' },
      { role: 'assistant', content: 'Nice!' },
    ]);
  });

  it('uses the injected source-neutral knowledge provider for approved context', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const history = new History();
    const telnyx = new FakeAiTelnyxDispatcher();
    let approvedContext = '';
    const openai = {
      async generate(request: { approvedContext: string }) {
        approvedContext = request.approvedContext;
        return { kind: 'answer' as const, text: 'The answer is approved.' };
      },
    };
    const load = vi.fn(async (eventId: string) => ({
      eventId,
      event: { status: 'active', effective_from: '', review_by: '' },
      eventMarkdown: 'Chatwoot snapshot answer',
      sharedMarkdown: 'Shared answer',
    }));
    const deps = {
      config: { ...config, ai: { ...config.ai!, knowledgeSource: 'chatwoot' as const } },
      store,
      openai,
      history,
      telnyx,
      knowledge: { load },
    };

    const result = await processAiPostInbound(input('inbound-provider', 34), deps);

    expect(result.outcome).toBe('answered');
    expect(load).toHaveBeenCalledWith('jama-ama-v1.3');
    expect(approvedContext).toBe('Chatwoot snapshot answer\nShared answer');
  });

  it('preserves local no-knowledge-base behavior without invoking a provider', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const history = new History();
    const telnyx = new FakeAiTelnyxDispatcher();
    const load = vi.fn(async () => ({
      eventId: 'unexpected',
      event: { status: 'active', effective_from: '', review_by: '' },
      eventMarkdown: 'unexpected',
      sharedMarkdown: '',
    }));
    let requestEventId = '';
    const openai = {
      async generate(request: { eventId: string }) {
        requestEventId = request.eventId;
        return { kind: 'answer' as const, text: 'The smoke answer.' };
      },
    };
    const result = await processAiPostInbound(input('inbound-local-no-knowledge', 35), {
      config,
      store,
      openai,
      history,
      telnyx,
      knowledge: { load },
    });

    expect(result.outcome).toBe('answered');
    expect(requestEventId).toBe('no-knowledge-base');
    expect(load).not.toHaveBeenCalled();
  });

  it('treats two distinct inbound messages with identical text as separate replies', async () => {
    const store = new FakeOperationalStore(':memory:');
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
