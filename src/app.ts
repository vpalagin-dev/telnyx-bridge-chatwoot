import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ChatwootClient } from './chatwoot/client.js';
import type { BridgeConfig } from './config/env.js';
import type { BridgeStore } from './db/store.js';
import { processTelnyxInbound } from './inbound/process-inbound.js';
import { processChatwootOutbound } from './outbound/process-outbound.js';
import { verifyChatwootWebhook, verifyTelnyxWebhook } from './security/webhook-auth.js';
import type { TelnyxClient } from './telnyx/client.js';

type AppDependencies = {
  config: BridgeConfig;
  store: BridgeStore;
  chatwoot: ChatwootClient;
  telnyx: TelnyxClient;
};

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function buildApp(dependencies?: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  app.get('/health', async () => ({ status: 'ok' }));

  if (dependencies) {
    app.post('/webhooks/telnyx', async (request, reply) => {
      const rawBody = String(request.body ?? '');
      const authenticated = verifyTelnyxWebhook({
        rawBody,
        timestamp: header(request.headers['telnyx-timestamp']),
        signature: header(request.headers['telnyx-signature-ed25519']),
        publicKey: dependencies.config.telnyx.publicKey,
        toleranceSeconds: dependencies.config.webhookToleranceSeconds,
      });
      if (!authenticated) return reply.code(401).send({ error: 'unauthorized' });

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ error: 'invalid_payload' });
      }

      try {
        const result = await processTelnyxInbound(payload, {
          store: dependencies.store,
          chatwoot: dependencies.chatwoot,
          senderNumber: dependencies.config.telnyx.senderNumber,
        });
        return reply.code(200).send(result);
      } catch (error) {
        if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload' });
        return reply.code(503).send({ error: 'processing_failed' });
      }
    });

    app.post('/webhooks/chatwoot', async (request, reply) => {
      const rawBody = String(request.body ?? '');
      const authenticated = verifyChatwootWebhook({
        rawBody,
        timestamp: header(request.headers['x-chatwoot-timestamp']),
        signature: header(request.headers['x-chatwoot-signature']),
        secret: dependencies.config.chatwoot.webhookSecret,
        toleranceSeconds: dependencies.config.webhookToleranceSeconds,
      });
      if (!authenticated) return reply.code(401).send({ error: 'unauthorized' });

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ error: 'invalid_payload' });
      }

      try {
        const result = await processChatwootOutbound(payload, {
          store: dependencies.store,
          telnyx: dependencies.telnyx,
          accountId: dependencies.config.chatwoot.accountId,
          inboxId: dependencies.config.chatwoot.inboxId,
          senderNumber: dependencies.config.telnyx.senderNumber,
          outboundMode: dependencies.config.outbound.mode,
          ...(dependencies.config.outbound.testRecipientNumber
            ? { testRecipientNumber: dependencies.config.outbound.testRecipientNumber }
            : {}),
        });
        return reply.code(200).send(result);
      } catch (error) {
        if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload' });
        return reply.code(503).send({ error: 'processing_failed' });
      }
    });
  }

  return app;
}
