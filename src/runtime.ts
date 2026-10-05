import { buildApp } from './app.js';
import { HttpChatwootClient } from './chatwoot/http-client.js';
import type { BridgeConfig } from './config/env.js';
import { BridgeStore } from './db/store.js';
import type { TelnyxClient } from './telnyx/client.js';
import { HttpTelnyxClient } from './telnyx/http-client.js';
import { FakeOpenAiAdapter } from './ai/openai-fake.js';
import { LiveOpenAiAdapter } from './ai/openai-live.js';
import { createAiTelnyxDispatcher } from './ai/telnyx-dispatch.js';
import type { OpenAiAdapter, AiTelnyxDispatcher, ChatwootAiHistoryWriter } from './ai/types.js';
import { PostgresStore } from './persistence/postgres-store.js';

const defaults = (c: BridgeConfig): BridgeConfig => ({
  ...c,
  ai: c.ai ?? {
    enabled: false,
    providerMode: 'fake',
    liveOpenAiEnabled: false,
    model: 'gpt-4o-mini',
    maxInputTokens: 2048,
    maxOutputTokens: 256,
    timeoutMs: 5_000,
    knowledgeRoot: 'specs/002-jama-ai-assistant-smoke/knowledge',
    safeFallbackText: "I'm not sure about that. Let me get someone from the JAMA team to help you.",
    escalationEnabled: true,
  },
  aiOutbound: c.aiOutbound ?? { liveSmsApproved: false, recipientAllowlist: [] },
});

export function createTelnyxClient(c: BridgeConfig): TelnyxClient {
  return c.outbound.mode === 'fake'
    ? { async sendSms() { throw new Error('Telnyx HTTP API is disabled while OUTBOUND_MODE=fake'); } }
    : new HttpTelnyxClient({ apiKey: c.telnyx.apiKey });
}

export type RuntimePipeline = {
  config: BridgeConfig;
  store: BridgeStore;
  chatwoot: HttpChatwootClient;
  telnyx: TelnyxClient;
  openai: OpenAiAdapter;
  history: ChatwootAiHistoryWriter;
  aiTelnyx: AiTelnyxDispatcher;
};

/**
 * Shared operational pipeline for web and worker roles. BridgeStore remains the
 * configured persistent operational state for the existing inbound/AI pipeline;
 * PostgreSQL receipt status is owned separately by PostgresStore.
 */
export function createRuntimePipeline(raw: BridgeConfig): RuntimePipeline {
  const config = defaults(raw);
  const store = new BridgeStore(config.databasePath);
  const chatwoot = new HttpChatwootClient({
    baseUrl: config.chatwoot.url,
    accountId: config.chatwoot.accountId,
    inboxId: config.chatwoot.inboxId,
    apiToken: config.chatwoot.apiToken,
  });
  const telnyx = createTelnyxClient(config);
  const openai = config.ai!.enabled && config.ai!.providerMode === 'live' && config.ai!.liveOpenAiEnabled && config.ai!.openAiApiKey
    ? new LiveOpenAiAdapter({ apiKey: config.ai!.openAiApiKey, model: config.ai!.model, timeoutMs: config.ai!.timeoutMs })
    : new FakeOpenAiAdapter({ kind: 'fallback', text: config.ai!.safeFallbackText, escalate: true });
  const aiTelnyx = createAiTelnyxDispatcher(config, telnyx, store);
  return { config, store, chatwoot, telnyx, openai, history: chatwoot, aiTelnyx };
}

export function buildRuntime(raw: BridgeConfig) {
  const pipeline = createRuntimePipeline(raw);
  const postgres = pipeline.config.persistence.mode === 'postgres_redis'
    ? new PostgresStore(pipeline.config.persistence.databaseUrl!)
    : undefined;
  const app = buildApp({
    config: pipeline.config,
    store: pipeline.store,
    chatwoot: pipeline.chatwoot,
    telnyx: pipeline.telnyx,
    ai: { openai: pipeline.openai, history: pipeline.history, telnyx: pipeline.aiTelnyx },
    ...(postgres ? { receiptAdapter: postgres } : {}),
  });
  if (postgres) {
    app.addHook('onReady', async () => postgres.initialize());
    app.addHook('onClose', async () => postgres.close());
  }
  app.addHook('onClose', async () => pipeline.store.close());
  return app;
}
