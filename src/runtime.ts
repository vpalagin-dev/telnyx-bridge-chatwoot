import { Pool } from 'pg';
import { buildApp } from './app.js';
import { HttpChatwootClient } from './chatwoot/http-client.js';
import type { BridgeConfig } from './config/env.js';
import type { TelnyxClient } from './telnyx/client.js';
import { HttpTelnyxClient } from './telnyx/http-client.js';
import { FakeOpenAiAdapter } from './ai/openai-fake.js';
import { LiveOpenAiAdapter } from './ai/openai-live.js';
import { createAiTelnyxDispatcher } from './ai/telnyx-dispatch.js';
import type { OpenAiAdapter, AiTelnyxDispatcher, ChatwootAiHistoryWriter } from './ai/types.js';
import { PostgresStore } from './persistence/postgres-store.js';
import { PostgresOperationalStore } from './persistence/postgres-operational-store.js';

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
  pool: Pool;
  operationalStore: PostgresOperationalStore;
  receiptStore: PostgresStore;
  chatwoot: HttpChatwootClient;
  telnyx: TelnyxClient;
  openai: OpenAiAdapter;
  history: ChatwootAiHistoryWriter;
  aiTelnyx: AiTelnyxDispatcher;
};

export function createRuntimePipeline(raw: BridgeConfig): RuntimePipeline {
  const config = defaults(raw);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const operationalStore = new PostgresOperationalStore(config.databaseUrl, pool);
  const receiptStore = new PostgresStore(config.databaseUrl, pool);
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
  const aiTelnyx = createAiTelnyxDispatcher(config, telnyx, operationalStore);
  return { config, pool, operationalStore, receiptStore, chatwoot, telnyx, openai, history: chatwoot, aiTelnyx };
}

export function buildRuntime(raw: BridgeConfig) {
  const pipeline = createRuntimePipeline(raw);
  const app = buildApp({
    config: pipeline.config,
    store: pipeline.operationalStore,
    chatwoot: pipeline.chatwoot,
    telnyx: pipeline.telnyx,
    ai: { openai: pipeline.openai, history: pipeline.history, telnyx: pipeline.aiTelnyx },
    receiptAdapter: pipeline.receiptStore,
  });
  app.addHook('onReady', async () => {
    await pipeline.receiptStore.initialize();
    await pipeline.operationalStore.initialize();
  });
  app.addHook('onClose', async () => pipeline.pool.end());
  return app;
}


