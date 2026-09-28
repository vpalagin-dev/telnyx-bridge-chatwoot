import { buildApp } from './app.js';
import { HttpChatwootClient } from './chatwoot/http-client.js';
import type { BridgeConfig } from './config/env.js';
import { BridgeStore } from './db/store.js';
import type { TelnyxClient } from './telnyx/client.js';
import { HttpTelnyxClient } from './telnyx/http-client.js';

export function createTelnyxClient(config: BridgeConfig): TelnyxClient {
  if (config.outbound.mode === 'fake') {
    return {
      async sendSms() {
        throw new Error('Telnyx HTTP API is disabled while OUTBOUND_MODE=fake');
      },
    };
  }
  return new HttpTelnyxClient({ apiKey: config.telnyx.apiKey });
}

export function buildRuntime(config: BridgeConfig) {
  const store = new BridgeStore(config.databasePath);
  const chatwoot = new HttpChatwootClient({
    baseUrl: config.chatwoot.url,
    accountId: config.chatwoot.accountId,
    inboxId: config.chatwoot.inboxId,
    apiToken: config.chatwoot.apiToken,
  });
  const telnyx = createTelnyxClient(config);
  const app = buildApp({ config, store, chatwoot, telnyx });
  app.addHook('onClose', async () => store.close());
  return app;
}
