import { describe, expect, it } from 'vitest';
import type { BridgeConfig } from '../../src/config/env.js';
import { buildRuntime, createTelnyxClient } from '../../src/runtime.js';
import { HttpTelnyxClient } from '../../src/telnyx/http-client.js';

const config: BridgeConfig = {
  environment: 'test',
  server: { host: '127.0.0.1', port: 3000 },
  databasePath: ':memory:',
  chatwoot: { url: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test-token' },
  telnyx: { apiKey: 'test-key', senderNumber: '+15551234567' },
  outbound: { mode: 'fake' },
  webhookToleranceSeconds: 300,
};

describe('buildRuntime', () => {
  it('composes the bridge without contacting external services at startup', async () => {
    const app = buildRuntime(config);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
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

  it('uses the Telnyx HTTP client only in live outbound mode', () => {
    const client = createTelnyxClient({
      ...config,
      outbound: { mode: 'live', testRecipientNumber: '+14155552671' },
    });

    expect(client).toBeInstanceOf(HttpTelnyxClient);
  });
});
