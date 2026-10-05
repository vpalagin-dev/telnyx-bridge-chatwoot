import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { HttpChatwootClient } from '../../../src/chatwoot/http-client.js';
import { FakeOperationalStore } from '../../helpers/fake-operational-store.js';
import { processTelnyxInbound } from '../../../src/inbound/process-inbound.js';
import { LiveOpenAiAdapter } from '../../../src/ai/openai-live.js';
import { FakeAiTelnyxDispatcher } from '../../../src/ai/telnyx-dispatch.js';
import { buildPostInboundAiHook } from '../../../src/ai/process-ai.js';

const requiredGateNames = [
  'RUN_LOCAL_LIVE_AI_CHATWOOT',
  'AI_ENABLED',
  'AI_PROVIDER_MODE',
  'AI_LIVE_OPENAI_ENABLED',
  'OUTBOUND_MODE',
  'OPENAI_API_KEY',
  'AI_DEFAULT_EVENT_ID',
] as const;

function localLiveAiChatwootEnabled(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.RUN_LOCAL_LIVE_AI_CHATWOOT === 'true' &&
    environment.AI_ENABLED === 'true' &&
    environment.AI_PROVIDER_MODE === 'live' &&
    environment.AI_LIVE_OPENAI_ENABLED === 'true' &&
    environment.OUTBOUND_MODE === 'fake' &&
    Boolean(environment.OPENAI_API_KEY?.trim()) &&
    Boolean(environment.AI_DEFAULT_EVENT_ID?.trim())
  );
}

function configuredForLocalChatwoot(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.CHATWOOT_URL === 'http://localhost:3001' &&
    Boolean(environment.CHATWOOT_ACCOUNT_ID) &&
    Boolean(environment.CHATWOOT_INBOX_ID) &&
    Boolean(environment.CHATWOOT_API_TOKEN?.trim()) &&
    Boolean(environment.TELNYX_SENDER_NUMBER)
  );
}

async function readConversationMessages(config: ReturnType<typeof loadConfig>, conversationId: number) {
  const response = await fetch(
    `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/conversations/${conversationId}/messages`,
    { headers: { api_access_token: config.chatwoot.apiToken } },
  );
  if (!response.ok) throw new Error(`Chatwoot message lookup failed with status ${response.status}`);
  const body = (await response.json()) as { payload?: unknown };
  return Array.isArray(body.payload) ? body.payload : [];
}

const enabled = localLiveAiChatwootEnabled(process.env) && configuredForLocalChatwoot(process.env);

describe('protected local live-AI Chatwoot smoke', () => {
  const stores: FakeOperationalStore[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const store of stores.splice(0)) store.close();
  });

  it('requires every explicit live-AI gate', () => {
    const gates: NodeJS.ProcessEnv = {
      RUN_LOCAL_LIVE_AI_CHATWOOT: 'true',
      AI_ENABLED: 'true',
      AI_PROVIDER_MODE: 'live',
      AI_LIVE_OPENAI_ENABLED: 'true',
      OUTBOUND_MODE: 'fake',
      OPENAI_API_KEY: 'injected-outside-source-control',
      AI_DEFAULT_EVENT_ID: 'event-afrorave-river',
    };
    expect(localLiveAiChatwootEnabled(gates)).toBe(true);
    for (const name of requiredGateNames) {
      const incomplete = { ...gates };
      delete incomplete[name];
      expect(localLiveAiChatwootEnabled(incomplete)).toBe(false);
    }
    expect(localLiveAiChatwootEnabled({ ...gates, OUTBOUND_MODE: 'live' })).toBe(false);
  });

  it.skipIf(!enabled)('processes one real inbound through Chatwoot, then deduplicates replay', async () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: 'postgresql://test-only',
      AI_KNOWLEDGE_ROOT: 'specs/002-jama-ai-assistant-smoke/knowledge',
      TELNYX_API_KEY: process.env.TELNYX_API_KEY ?? 'local-smoke-no-network-key',
    };
    const config = loadConfig(environment);
    if (!config.ai?.openAiApiKey || !config.ai.defaultEventId) throw new Error('live-AI gate unexpectedly incomplete');

    const telnyxNetworkCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('api.telnyx.com')) {
        telnyxNetworkCalls.push(url);
        throw new Error('real Telnyx network call attempted during local live-AI smoke');
      }
      return originalFetch(input, init);
    });

    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const fakeTelnyx = new FakeAiTelnyxDispatcher();
    const chatwoot = new HttpChatwootClient({
      baseUrl: config.chatwoot.url,
      accountId: config.chatwoot.accountId,
      inboxId: config.chatwoot.inboxId,
      apiToken: config.chatwoot.apiToken,
    });
    const openai = new LiveOpenAiAdapter({
      apiKey: config.ai.openAiApiKey,
      model: config.ai.model,
      timeoutMs: config.ai.timeoutMs,
    });
    const postInbound = buildPostInboundAiHook({
      config,
      store,
      openai,
      history: chatwoot,
      telnyx: fakeTelnyx,
    });
    const synthetic = {
      data: {
        id: `local-live-ai-chatwoot-event-${Date.now()}`,
        event_type: 'message.received',
        payload: {
          id: `local-live-ai-chatwoot-message-${Date.now()}`,
          direction: 'inbound',
          type: 'SMS',
          from: { phone_number: '+14155552671' },
          to: [{ phone_number: config.telnyx.senderNumber }],
          text: 'Where is the demo venue for AfroRave River?',
        },
      },
    } as const;

    const first = await processTelnyxInbound(synthetic, {
      store,
      chatwoot,
      senderNumber: config.telnyx.senderNumber,
      postInbound,
    });
    expect(first.outcome).toBe('created');
    if (first.outcome !== 'created') throw new Error('synthetic inbound was not created');

    const decision = store.getAiDecision(synthetic.data.payload.id);
    expect(decision).not.toBeNull();
    expect(decision?.outcome).toBe('answered');
    expect(decision?.chatwootHistoryMessageId).toEqual(expect.any(Number));
    expect(decision?.telnyxActionId).toEqual(expect.any(String));
    expect(decision?.telnyxMessageId).toEqual(expect.stringContaining('fake-ai-'));
    expect(fakeTelnyx.calls).toHaveLength(1);
    expect(fakeTelnyx.calls[0]?.to).toBe('+14155552671');

    const messages = await readConversationMessages(config, first.chatwootConversationId);
    const inbound = messages.find((message: any) => message.id === first.chatwootMessageId) as any;
    const history = messages.find((message: any) => message.id === decision?.chatwootHistoryMessageId) as any;
    expect(inbound).toBeTruthy();
    expect(history).toBeTruthy();
    expect(history.conversation_id ?? history.conversation?.id).toBe(first.chatwootConversationId);
    if (history.custom_attributes?.ai_generated === true) {
      expect(messages.filter((message: any) => message.custom_attributes?.ai_generated === true)).toHaveLength(1);
    } else {
      expect(store.isAiHistoryMessage(history.id)).toBe(true);
    }
    expect(fakeTelnyx.calls[0]?.text).toBe(history.content);

    const replay = await processTelnyxInbound(synthetic, {
      store,
      chatwoot,
      senderNumber: config.telnyx.senderNumber,
      postInbound,
    });
    expect(replay).toEqual({ outcome: 'duplicate', telnyxEventId: synthetic.data.id });
    expect(fakeTelnyx.calls).toHaveLength(1);
    const replayMessages = await readConversationMessages(config, first.chatwootConversationId);
    expect(replayMessages.filter((message: any) => message.id === decision?.chatwootHistoryMessageId)).toHaveLength(1);
    expect(store.getAiDecision(synthetic.data.payload.id)).toMatchObject({
      chatwootHistoryMessageId: decision?.chatwootHistoryMessageId,
      telnyxActionId: decision?.telnyxActionId,
    });
    expect(telnyxNetworkCalls).toHaveLength(0);

    for (const name of requiredGateNames) {
      if (name === 'OPENAI_API_KEY') continue;
      expect(environment[name]).toBeDefined();
    }
  }, 30000);
});

export { localLiveAiChatwootEnabled };
