import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeOperationalStore } from '../helpers/fake-operational-store.js';
import { processChatwootOutbound } from '../../src/outbound/process-outbound.js';
import type { TelnyxClient, TelnyxSendInput } from '../../src/telnyx/client.js';
import { HttpTelnyxClient } from '../../src/telnyx/http-client.js';

class FakeTelnyx implements TelnyxClient {
  calls: TelnyxSendInput[] = [];

  async sendSms(input: TelnyxSendInput) {
    this.calls.push(input);
    return { id: 'telnyx-message-1' };
  }
}

const stores: FakeOperationalStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function fixture() {
  return JSON.parse(readFileSync(new URL('../fixtures/chatwoot/outgoing-message.json', import.meta.url), 'utf8'));
}

function setup() {
  const store = new FakeOperationalStore(':memory:');
  stores.push(store);
  store.bindConversation(20, '+14155552671');
  return { store, telnyx: new FakeTelnyx() };
}

describe('processChatwootOutbound', () => {
  it('sends one human Chatwoot action through Telnyx in live mode', async () => {
    const { store, telnyx } = setup();

    const result = await processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live',
      testRecipientNumber: '+14155552671',
    });

    expect(result).toEqual({ outcome: 'sent', actionId: '9001', telnyxMessageId: 'telnyx-message-1' });
    expect(telnyx.calls).toEqual([
      { from: '+15551234567', to: '+14155552671', text: 'Reply from fixture' },
    ]);
  });

  it('completes fake-mode Chatwoot outbound without invoking the Telnyx client', async () => {
    const { store, telnyx } = setup();

    const result = await processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'fake',
    });

    expect(result).toEqual({ outcome: 'sent', actionId: '9001', telnyxMessageId: 'fake-chatwoot-9001' });
    expect(telnyx.calls).toHaveLength(0);
    expect(store.getOutboundAction('9001')).toEqual({
      status: 'sent',
      telnyxMessageId: 'fake-chatwoot-9001',
    });
  });

  it('never calls the Telnyx HTTP API in fake mode even when an HTTP client is composed', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    store.bindConversation(20, '+14155552671');
    const fetcher = async () => {
      throw new Error('Telnyx HTTP API must not be called in fake mode');
    };
    const telnyx = new HttpTelnyxClient({ apiKey: 'telnyx-key-for-test', fetcher });

    const result = await processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'fake',
    });

    expect(result).toEqual({ outcome: 'sent', actionId: '9001', telnyxMessageId: 'fake-chatwoot-9001' });
  });

  it('does not call Telnyx unless outbound mode is an explicit live send', async () => {
    const { store, telnyx } = setup();

    await expect(processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'oops' as unknown as 'live',
    })).rejects.toThrow(/OUTBOUND_MODE/);

    expect(telnyx.calls).toHaveLength(0);
    expect(store.getOutboundAction('9001')).toBeNull();
  });

  it('rejects a live-mode recipient outside the test allowlist before invoking Telnyx', async () => {
    const { store, telnyx } = setup();

    const result = await processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live',
      testRecipientNumber: '+14155550000',
    });

    expect(result).toEqual({ outcome: 'recipient_not_allowlisted', actionId: '9001' });
    expect(telnyx.calls).toHaveLength(0);
    expect(store.getOutboundAction('9001')).toBeNull();
  });

  it('does not call Telnyx twice for a duplicate Chatwoot action', async () => {
    const { store, telnyx } = setup();
    const dependencies = {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live' as const,
      testRecipientNumber: '+14155552671',
    };

    await processChatwootOutbound(fixture(), dependencies);
    const duplicate = await processChatwootOutbound(fixture(), dependencies);

    expect(duplicate).toEqual({ outcome: 'duplicate', actionId: '9001' });
    expect(telnyx.calls).toHaveLength(1);
  });

  it('blocks suppressed outbound before Telnyx', async () => {
    const { store, telnyx } = setup();
    store.suppress('+14155552671', 'evt-stop-1');

    const result = await processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live',
      testRecipientNumber: '+14155552671',
    });

    expect(result).toEqual({ outcome: 'suppressed', actionId: '9001' });
    expect(telnyx.calls).toHaveLength(0);
  });

  it.each([
    ['campaign', { campaign_id: 123 }],
    ['automation', { automation_rule_id: 456 }],
    ['template', { template_params: { name: 'promo' } }],
    ['attachment', { attachments: [{ id: 1 }] }],
  ])('ignores %s-marked events without calling Telnyx', async (_name, marker) => {
    const { store, telnyx } = setup();
    const event = Object.assign(fixture(), marker);

    const result = await processChatwootOutbound(event, {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live',
      testRecipientNumber: '+14155552671',
    });

    expect(result.outcome).toBe('ignored');
    expect(telnyx.calls).toHaveLength(0);
  });

  it('treats a stale submitting claim as unknown instead of resubmitting', async () => {
    const { store, telnyx } = setup();
    store.claimOutboundAction('9001');

    const result = await processChatwootOutbound(fixture(), {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live',
      testRecipientNumber: '+14155552671',
    });

    expect(result).toEqual({ outcome: 'unknown_needs_review', actionId: '9001' });
    expect(telnyx.calls).toHaveLength(0);
  });

  it('records an ambiguous Telnyx failure and never submits the action twice', async () => {
    const { store, telnyx } = setup();
    telnyx.sendSms = async (input) => { telnyx.calls.push(input); throw new Error('timeout'); };
    const dependencies = {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live' as const,
      testRecipientNumber: '+14155552671',
    };

    await expect(processChatwootOutbound(fixture(), dependencies)).rejects.toThrow('timeout');
    const duplicate = await processChatwootOutbound(fixture(), dependencies);

    expect(duplicate).toEqual({ outcome: 'unknown_needs_review', actionId: '9001' });
    expect(telnyx.calls).toHaveLength(1);
    expect(store.getOutboundAction('9001')).toEqual({ status: 'unknown_needs_review', telnyxMessageId: null });
  });

  it('ignores non-human or wrong-inbox events without calling Telnyx', async () => {
    const { store, telnyx } = setup();
    const event = fixture();
    event.sender.type = 'agent_bot';

    const result = await processChatwootOutbound(event, {
      store,
      telnyx,
      accountId: 1,
      inboxId: 2,
      senderNumber: '+15551234567',
      outboundMode: 'live',
      testRecipientNumber: '+14155552671',
    });

    expect(result.outcome).toBe('ignored');
    expect(telnyx.calls).toHaveLength(0);
  });
});
