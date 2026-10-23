import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { BridgeConfig } from '../../src/config/env.js';
import type { BroadcastStore, ChatwootAudienceClient } from '../../src/broadcast/types.js';
import { FakeOperationalStore } from '../helpers/fake-operational-store.js';
import type { ChatwootClient } from '../../src/chatwoot/client.js';
import type { TelnyxClient } from '../../src/telnyx/client.js';

class FakeBroadcastStore implements BroadcastStore {
  campaigns: unknown[] = [];
  async createCampaign(input: Parameters<BroadcastStore['createCampaign']>[0]): Promise<void> {
    this.campaigns.push(input);
  }
  async claimDueCampaign() { return null; }
  async updateProgress(): Promise<void> {}
}

const audience: ChatwootAudienceClient = {
  async listLabels() { return [{ title: 'vip' }]; },
  async listRecipientPhones() { return []; },
};

const chatwoot = {
  async findContactByPhone() { return null; },
  async findContactByIdentifier() { return null; },
  async createContact() { return { id: 1, sourceId: 's' }; },
  async upsertCrmContact() { return { id: 1, sourceId: 's' }; },
  async findConversation() { return null; },
  async createConversation() { return { id: 20, status: 'open' as const }; },
  async reopenConversation() {},
  async createIncomingMessage() { return { id: 1 }; },
  async getConversationContactPhone() { return null; },
  async listConversationMessages() { return []; },
} satisfies ChatwootClient;

const telnyx: TelnyxClient = { async sendSms() { return { id: 'x' }; } };

function config(): BridgeConfig {
  return {
    environment: 'test',
    server: { host: '127.0.0.1', port: 3000 },
    databaseUrl: 'postgresql://test-only',
    persistence: { redisPrefix: 'telnyx-bridge:' },
    runtimeRole: 'web',
    chatwoot: { url: 'http://localhost:3001', accountId: 6, inboxId: 1, apiToken: 'token', webhookSecret: 'secret' },
    telnyx: { apiKey: 'key', senderNumber: '+15551234567' },
    outbound: { mode: 'fake' },
    webhookToleranceSeconds: 300,
    broadcast: {
      enabled: true,
      adminToken: 'test-broadcast-admin-token',
      inboxDisplayName: 'JAMA SMS',
      messageMaxLength: 200,
      delayMs: 500,
    },
  };
}

describe('broadcast admin page', () => {
  it('requires the admin token', async () => {
    const app = buildApp({
      config: config(),
      store: new FakeOperationalStore(':memory:'),
      chatwoot,
      telnyx,
      broadcast: { store: new FakeBroadcastStore(), audience },
    });
    const response = await app.inject({ method: 'GET', url: '/admin/broadcast' });
    expect(response.statusCode).toBe(401);
  });

  it('renders the campaign form for a valid token', async () => {
    const app = buildApp({
      config: config(),
      store: new FakeOperationalStore(':memory:'),
      chatwoot,
      telnyx,
      broadcast: { store: new FakeBroadcastStore(), audience },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/admin/broadcast?token=test-broadcast-admin-token',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Create SMS campaign');
    expect(response.body).toContain('JAMA SMS');
    expect(response.body).toContain('vip');
  });
});
