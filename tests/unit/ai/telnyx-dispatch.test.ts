import { describe, expect, it, vi } from 'vitest';
import { LiveAiTelnyxDispatcher } from '../../../src/ai/telnyx-dispatch.js';
import type { BridgeConfig } from '../../../src/config/env.js';
import { FakeOperationalStore } from '../../helpers/fake-operational-store.js';

const baseConfig: BridgeConfig = {
  environment: 'test',
  server: { host: '127.0.0.1', port: 1 },
  databaseUrl: 'postgresql://test-only',
  persistence: { redisUrl: undefined, redisPrefix: 'telnyx-bridge:' },
  runtimeRole: 'worker',
  chatwoot: { url: 'http://localhost:3001', accountId: 1, inboxId: 1, apiToken: 'x' },
  telnyx: { apiKey: 'x', senderNumber: '+15551234567' },
  outbound: { mode: 'live' },
  webhookToleranceSeconds: 300,
  aiOutbound: { liveSmsApproved: true, recipientAllowlist: [] },
};

describe('LiveAiTelnyxDispatcher', () => {
  it('sends to any inbound recipient when allowlist is empty', async () => {
    const store = new FakeOperationalStore();
    const sendSms = vi.fn(async () => ({ id: 'msg-live-1' }));
    const dispatcher = new LiveAiTelnyxDispatcher({ sendSms } as never, baseConfig, store);

    const result = await dispatcher.submit({
      from: '+15551234567',
      to: '+14155559999',
      text: 'Hello',
      aiDecisionId: 'dec-1',
    });

    expect(sendSms).toHaveBeenCalledWith({
      from: '+15551234567',
      to: '+14155559999',
      text: 'Hello',
    });
    expect(result).toMatchObject({ telnyxMessageId: 'msg-live-1', mode: 'live' });
  });

  it('blocks recipients outside a non-empty optional allowlist', async () => {
    const store = new FakeOperationalStore();
    const sendSms = vi.fn();
    const config: BridgeConfig = {
      ...baseConfig,
      aiOutbound: { liveSmsApproved: true, recipientAllowlist: ['+14155552671'] },
    };
    const dispatcher = new LiveAiTelnyxDispatcher({ sendSms } as never, config, store);

    await expect(dispatcher.submit({
      from: '+15551234567',
      to: '+14155559999',
      text: 'Hello',
      aiDecisionId: 'dec-2',
    })).rejects.toThrow(/AI live SMS gate blocked/);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
