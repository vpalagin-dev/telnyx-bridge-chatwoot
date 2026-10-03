import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { ChatwootClient } from '../../src/chatwoot/client.js';
import { BridgeStore } from '../../src/db/store.js';
import type { BridgeConfig } from '../../src/config/env.js';
import type { TelnyxClient, TelnyxSendInput } from '../../src/telnyx/client.js';
import { HttpTelnyxClient } from '../../src/telnyx/http-client.js';

class FakeChatwoot implements ChatwootClient {
  messageCalls = 0;
  async findContactByPhone() { return { id: 10, sourceId: 'source-10' }; }
  async createContact() { return { id: 10, sourceId: 'source-10' }; }
  async findConversation() { return { id: 20, status: 'open' as const }; }
  async createConversation() { return { id: 20, status: 'open' as const }; }
  async reopenConversation() {}
  async createIncomingMessage() { this.messageCalls += 1; return { id: 30 }; }
}

class FakeTelnyx implements TelnyxClient {
  calls: TelnyxSendInput[] = [];
  async sendSms(input: TelnyxSendInput) { this.calls.push(input); return { id: 'fake-telnyx-id' }; }
}

const resources: Array<{ close(): void | Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

function fixture(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').trim();
}

function config(publicKey: string): BridgeConfig {
  return {
    environment: 'test',
    server: { host: '127.0.0.1', port: 3000 },
    databasePath: ':memory:',
    chatwoot: {
      url: 'http://localhost:3001', accountId: 1, inboxId: 2,
      apiToken: 'chatwoot-token-for-test', webhookSecret: 'chatwoot-secret-for-test',
    },
    telnyx: { apiKey: 'telnyx-key-for-test', publicKey, senderNumber: '+15551234567' },
    outbound: { mode: 'live', testRecipientNumber: '+14155552671' },
    webhookToleranceSeconds: 300,
  };
}

describe('webhook routes', () => {
  it('accepts a signed Telnyx fixture and deduplicates repeat delivery', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    const chatwoot = new FakeChatwoot();
    const telnyx = new FakeTelnyx();
    const app = buildApp({ config: config(publicKey.export({ type: 'spki', format: 'pem' }).toString()), store, chatwoot, telnyx });
    resources.push(app, store);
    const body = fixture('../fixtures/telnyx/message-received.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');

    const request = () => app.inject({
      method: 'POST', url: '/webhooks/telnyx', payload: body,
      headers: { 'content-type': 'application/json', 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature },
    });

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    expect(chatwoot.messageCalls).toBe(1);
  });

  it('accepts the base64 raw Ed25519 public key format used by Telnyx', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    const chatwoot = new FakeChatwoot();
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const rawPublicKey = spki.subarray(-32).toString('base64');
    const app = buildApp({ config: config(rawPublicKey), store, chatwoot, telnyx: new FakeTelnyx() });
    resources.push(app, store);
    const body = fixture('../fixtures/telnyx/message-received.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/telnyx', payload: body,
      headers: { 'content-type': 'application/json', 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature },
    });

    expect(response.statusCode).toBe(200);
    expect(chatwoot.messageCalls).toBe(1);
  });

  it('rejects invalid Telnyx authentication before side effects', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    const chatwoot = new FakeChatwoot();
    const app = buildApp({ config: config(publicKey.export({ type: 'spki', format: 'pem' }).toString()), store, chatwoot, telnyx: new FakeTelnyx() });
    resources.push(app, store);

    const response = await app.inject({
      method: 'POST', url: '/webhooks/telnyx', payload: fixture('../fixtures/telnyx/message-received.json'),
      headers: { 'content-type': 'application/json', 'telnyx-timestamp': String(Math.floor(Date.now() / 1000)), 'telnyx-signature-ed25519': 'invalid' },
    });

    expect(response.statusCode).toBe(401);
    expect(chatwoot.messageCalls).toBe(0);
  });

  it('accepts a signed Chatwoot fixture and does not submit a duplicate action twice', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    store.bindConversation(20, '+14155552671');
    const telnyx = new FakeTelnyx();
    const cfg = config(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    const app = buildApp({ config: cfg, store, chatwoot: new FakeChatwoot(), telnyx });
    resources.push(app, store);
    const body = fixture('../fixtures/chatwoot/outgoing-message.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', cfg.chatwoot.webhookSecret!).update(`${timestamp}.${body}`).digest('hex');

    const request = () => app.inject({
      method: 'POST', url: '/webhooks/chatwoot', payload: body,
      headers: { 'content-type': 'application/json', 'x-chatwoot-timestamp': timestamp, 'x-chatwoot-signature': signature },
    });

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    expect(telnyx.calls).toHaveLength(1);
  });

  it('accepts Chatwoot signatures with the sha256 prefix used by Chatwoot', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    store.bindConversation(20, '+14155552671');
    const telnyx = new FakeTelnyx();
    const cfg = config(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    const app = buildApp({ config: cfg, store, chatwoot: new FakeChatwoot(), telnyx });
    resources.push(app, store);
    const body = fixture('../fixtures/chatwoot/outgoing-message.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', cfg.chatwoot.webhookSecret!).update(`${timestamp}.${body}`).digest('hex');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/chatwoot', payload: body,
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-timestamp': timestamp,
        'x-chatwoot-signature': `sha256=${signature}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(telnyx.calls).toHaveLength(1);
  });

  it('never calls the Telnyx HTTP API for Chatwoot outbound in fake mode', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    store.bindConversation(20, '+14155552671');
    const fetcher = async () => {
      throw new Error('Telnyx HTTP API must not be called in fake mode');
    };
    const telnyx = new HttpTelnyxClient({ apiKey: 'telnyx-key-for-test', fetcher });
    const cfg = {
      ...config(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
      outbound: { mode: 'fake' as const },
    };
    const app = buildApp({ config: cfg, store, chatwoot: new FakeChatwoot(), telnyx });
    resources.push(app, store);
    const body = fixture('../fixtures/chatwoot/outgoing-message.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', cfg.chatwoot.webhookSecret!).update(`${timestamp}.${body}`).digest('hex');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/chatwoot', payload: body,
      headers: { 'content-type': 'application/json', 'x-chatwoot-timestamp': timestamp, 'x-chatwoot-signature': signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      outcome: 'sent',
      actionId: '9001',
      telnyxMessageId: 'fake-chatwoot-9001',
    });
  });

  it('rejects a live Chatwoot outbound to a non-allowlisted recipient before Telnyx', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    store.bindConversation(20, '+14155552671');
    const telnyx = new FakeTelnyx();
    const cfg = {
      ...config(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
      outbound: { mode: 'live' as const, testRecipientNumber: '+14155550000' },
    };
    const app = buildApp({ config: cfg, store, chatwoot: new FakeChatwoot(), telnyx });
    resources.push(app, store);
    const body = fixture('../fixtures/chatwoot/outgoing-message.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', cfg.chatwoot.webhookSecret!).update(`${timestamp}.${body}`).digest('hex');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/chatwoot', payload: body,
      headers: { 'content-type': 'application/json', 'x-chatwoot-timestamp': timestamp, 'x-chatwoot-signature': signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'recipient_not_allowlisted', actionId: '9001' });
    expect(telnyx.calls).toHaveLength(0);
  });

  it('rejects a correctly signed but stale Telnyx webhook', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    const chatwoot = new FakeChatwoot();
    const app = buildApp({ config: config(publicKey.export({ type: 'spki', format: 'pem' }).toString()), store, chatwoot, telnyx: new FakeTelnyx() });
    resources.push(app, store);
    const body = fixture('../fixtures/telnyx/message-received.json');
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/telnyx', payload: body,
      headers: { 'content-type': 'application/json', 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature },
    });

    expect(response.statusCode).toBe(401);
    expect(chatwoot.messageCalls).toBe(0);
  });

  it('acknowledges an authenticated irrelevant Telnyx event without Chatwoot side effects', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    const chatwoot = new FakeChatwoot();
    const app = buildApp({ config: config(publicKey.export({ type: 'spki', format: 'pem' }).toString()), store, chatwoot, telnyx: new FakeTelnyx() });
    resources.push(app, store);
    const event = JSON.parse(fixture('../fixtures/telnyx/message-received.json'));
    event.data.id = 'evt-irrelevant-1';
    event.data.payload.to[0].phone_number = '+15557654321';
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/telnyx', payload: body,
      headers: { 'content-type': 'application/json', 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ignored' });
    expect(chatwoot.messageCalls).toBe(0);
  });

  it('returns a retry-safe service error for downstream failures instead of calling them malformed', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    store.bindConversation(20, '+14155552671');
    const telnyx = new FakeTelnyx();
    telnyx.sendSms = async (input) => { telnyx.calls.push(input); throw new Error('timeout'); };
    const cfg = config(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    const app = buildApp({ config: cfg, store, chatwoot: new FakeChatwoot(), telnyx });
    resources.push(app, store);
    const body = fixture('../fixtures/chatwoot/outgoing-message.json');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', cfg.chatwoot.webhookSecret!).update(`${timestamp}.${body}`).digest('hex');

    const response = await app.inject({
      method: 'POST', url: '/webhooks/chatwoot', payload: body,
      headers: { 'content-type': 'application/json', 'x-chatwoot-timestamp': timestamp, 'x-chatwoot-signature': signature },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'processing_failed' });
    expect(telnyx.calls).toHaveLength(1);
  });

  it('rejects invalid Chatwoot authentication when a secret is configured', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const store = new BridgeStore(':memory:');
    const telnyx = new FakeTelnyx();
    const app = buildApp({ config: config(publicKey.export({ type: 'spki', format: 'pem' }).toString()), store, chatwoot: new FakeChatwoot(), telnyx });
    resources.push(app, store);

    const response = await app.inject({
      method: 'POST', url: '/webhooks/chatwoot', payload: fixture('../fixtures/chatwoot/outgoing-message.json'),
      headers: { 'content-type': 'application/json', 'x-chatwoot-timestamp': String(Math.floor(Date.now() / 1000)), 'x-chatwoot-signature': 'invalid' },
    });

    expect(response.statusCode).toBe(401);
    expect(telnyx.calls).toHaveLength(0);
  });
});
