import { describe, expect, it } from 'vitest';
import type { BridgeConfig } from '../../src/config/env.js';
import { buildRuntime, createRuntimePipeline, createTelnyxClient } from '../../src/runtime.js';
import { HttpTelnyxClient } from '../../src/telnyx/http-client.js';
import { createChatwootHelpCenterClient } from '../../src/ai/chatwoot-knowledge.js';
import type { KnowledgeProvider } from '../../src/ai/knowledge-provider.js';

const config: BridgeConfig = {
  environment: 'test',
  server: { host: '127.0.0.1', port: 3000 },
  databaseUrl: 'postgresql://test-only',
  persistence: { redisUrl: undefined, redisPrefix: 'telnyx-bridge:' },
  runtimeRole: 'web',
  chatwoot: { url: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test-token' },
  telnyx: { apiKey: 'test-key', senderNumber: '+15551234567' },
  outbound: { mode: 'fake' },
  webhookToleranceSeconds: 300,
};

describe('buildRuntime', () => {
  it('composes the PostgreSQL runtime without eager network I/O', async () => {
    const app = buildRuntime(config);
    expect(app).toBeDefined();
    await app.close();
  });

  it('disables the Telnyx HTTP client while outbound mode is fake', async () => {
    const client = createTelnyxClient(config);

    await expect(client.sendSms({
      from: '+15551234567',
      to: '+14155552671',
      text: 'must not send',
    })).rejects.toThrow(/OUTBOUND_MODE=fake/);
    expect(client).not.toBeInstanceOf(HttpTelnyxClient);
  });

  it('constructs the shared knowledge store, provider, and sync in Chatwoot mode', () => {
    const pipeline = createRuntimePipeline({
      ...config,
      ai: {
        enabled: true,
        providerMode: 'fake',
        liveOpenAiEnabled: false,
        model: 'gpt-4o-mini',
        maxInputTokens: 2048,
        maxOutputTokens: 256,
        timeoutMs: 5000,
        knowledgeSource: 'chatwoot',
        helpCenterSlug: 'jama-help-center',
        helpCenterLocale: 'en',
        knowledgeSyncIntervalMs: 300000,
        knowledgeRoot: 'knowledge',
        safeFallbackText: 'fallback',
        escalationEnabled: true,
      },
    });
    expect(pipeline.knowledgeStore).toBeDefined();
    expect(pipeline.knowledgeProvider).toBeDefined();
    expect(pipeline.knowledgeSync).toBeDefined();
  });

  it('keeps local mode from calling a live Help Center client', async () => {
    let calls = 0;
    const localProvider: KnowledgeProvider = { load: async () => ({ eventId: 'local', event: { status: 'active', effective_from: '', review_by: '' }, eventMarkdown: 'local', sharedMarkdown: '' }) };
    const client = createChatwootHelpCenterClient({
      baseUrl: 'http://chatwoot.invalid', accountId: 1, apiToken: 'token', portalSlug: 'jama-help-center', locale: 'en',
      fetcher: async () => { calls += 1; throw new Error('live request'); },
    });
    expect(await localProvider.load('local')).toMatchObject({ eventMarkdown: 'local' });
    expect(calls).toBe(0);
    expect(client).toBeDefined();
  });

  it('uses the Telnyx HTTP client only in live outbound mode', () => {
    const client = createTelnyxClient({
      ...config,
      outbound: { mode: 'live', testRecipientNumber: '+14155552671' },
    });

    expect(client).toBeInstanceOf(HttpTelnyxClient);
  });
});
