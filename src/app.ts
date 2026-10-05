import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import type { ChatwootClient } from './chatwoot/client.js';
import type { BridgeConfig } from './config/env.js';
import type { OperationalStore } from './persistence/operational-store.js';
import { processTelnyxInbound } from './inbound/process-inbound.js';
import { processChatwootOutbound } from './outbound/process-outbound.js';
import { debugTelnyxWebhook, verifyChatwootWebhook, verifyTelnyxWebhook } from './security/webhook-auth.js';
import type { TelnyxClient } from './telnyx/client.js';
import type { OpenAiAdapter, AiTelnyxDispatcher, ChatwootAiHistoryWriter } from './ai/types.js';
import { buildPostInboundAiHook } from './ai/process-ai.js';

type ReceiptAdapter = { insertReceipt(input: { provider: string; providerEventId: string; rawPayload: unknown }): Promise<{ inserted: boolean; receiptId: string }> };
type AppDependencies = {
  config: BridgeConfig;
  store: OperationalStore;
  chatwoot: ChatwootClient;
  telnyx: TelnyxClient;
  ai?: { openai: OpenAiAdapter; history: ChatwootAiHistoryWriter; telnyx: AiTelnyxDispatcher };
  receiptAdapter?: ReceiptAdapter;
};
const telnyxInboundSchema = z.object({ data: z.object({ id: z.string().min(1), event_type: z.string().min(1), occurred_at: z.unknown().optional(), record_type: z.unknown().optional(), payload: z.object({}).passthrough() }).passthrough() });
const header = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;

export function buildApp(d?: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_q, b, done) => done(null, b));
  app.get('/health', async () => ({ status: 'ok' }));
  if (!d) return app;
  app.post('/webhooks/telnyx', async (req, reply) => {
    if (!d.config.telnyx.publicKey) return reply.code(401).send({ error: 'unauthorized' });
    const raw = String(req.body ?? '');
    const auth = { rawBody: raw, timestamp: header(req.headers['telnyx-timestamp']), signature: header(req.headers['telnyx-signature-ed25519']), publicKey: d.config.telnyx.publicKey, toleranceSeconds: d.config.webhookToleranceSeconds };
    const authenticated = verifyTelnyxWebhook(auth);
    debugTelnyxWebhook(auth, authenticated);
    if (!authenticated) return reply.code(401).send({ error: 'unauthorized' });
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply.code(400).send({ error: 'invalid_payload' }); }
    try {
      const event = telnyxInboundSchema.parse(payload);
      if (!d.receiptAdapter) {
        const result = await processTelnyxInbound(payload, { store: d.store, chatwoot: d.chatwoot, senderNumber: d.config.telnyx.senderNumber });
        return reply.code(200).send(result);
      }
      const result = await d.receiptAdapter.insertReceipt({ provider: 'telnyx', providerEventId: event.data.id, rawPayload: payload });
      return reply.code(200).send({ accepted: true, receiptId: result.receiptId });
    } catch (e) {
      if (e instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload' });
      return reply.code(503).send({ error: 'processing_failed' });
    }
  });
  app.post('/webhooks/chatwoot', async (req, reply) => {
    const raw = String(req.body ?? '');
    if (!verifyChatwootWebhook({ rawBody: raw, timestamp: header(req.headers['x-chatwoot-timestamp']), signature: header(req.headers['x-chatwoot-signature']), secret: d.config.chatwoot.webhookSecret, toleranceSeconds: d.config.webhookToleranceSeconds })) return reply.code(401).send({ error: 'unauthorized' });
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply.code(400).send({ error: 'invalid_payload' }); }
    try {
      const result = await processChatwootOutbound(payload, { store: d.store, telnyx: d.telnyx, accountId: d.config.chatwoot.accountId, inboxId: d.config.chatwoot.inboxId, senderNumber: d.config.telnyx.senderNumber, outboundMode: d.config.outbound.mode, ...(d.config.outbound.testRecipientNumber ? { testRecipientNumber: d.config.outbound.testRecipientNumber } : {}) });
      return reply.code(200).send(result);
    } catch (e) { if (e instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload' }); return reply.code(503).send({ error: 'processing_failed' }); }
  });
  return app;
}

void processTelnyxInbound;
void buildPostInboundAiHook;
