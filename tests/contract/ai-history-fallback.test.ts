import { describe, expect, it } from 'vitest';
import { FakeOperationalStore } from '../helpers/fake-operational-store.js';
import { processChatwootOutbound } from '../../src/outbound/process-outbound.js';
import type { TelnyxClient } from '../../src/telnyx/client.js';

class NoNetworkTelnyx implements TelnyxClient {
  calls = 0;

  async sendSms(): Promise<{ id: string }> {
    this.calls += 1;
    throw new Error('Telnyx must not be called for an AI history fallback message');
  }
}

const event = {
  event: 'message_created',
  id: 742,
  message_type: 'outgoing',
  private: false,
  content: 'demo AI history',
  account: { id: 3 },
  inbox: { id: 3 },
  conversation: { id: 91 },
  sender: { type: 'user' },
};

describe('durable AI history-message fallback', () => {
  it('ignores a known AI history ID before human outbound eligibility', async () => {
    const store = new FakeOperationalStore(':memory:');
    const telnyx = new NoNetworkTelnyx();
    try {
      store.claimAiDecision({
        inboundIdentity: 'fallback-inbound-1',
        conversationId: event.conversation.id,
        inboundMessageId: 741,
        eventId: 'event-afrorave-river',
        aiDecisionId: 'ai-fallback-1',
      });
      store.recordAiHistoryMessage('ai-fallback-1', event.id);

      expect(store.isAiHistoryMessage(event.id)).toBe(true);
      await expect(
        processChatwootOutbound(event, {
          store,
          telnyx,
          accountId: event.account.id,
          inboxId: event.inbox.id,
          senderNumber: '+13126758095',
          outboundMode: 'live',
          testRecipientNumber: '+14155552671',
        }),
      ).resolves.toEqual({ outcome: 'ignored', actionId: String(event.id) });
      expect(telnyx.calls).toBe(0);
      expect(store.getOutboundAction(String(event.id))).toBeNull();
    } finally {
      store.close();
    }
  });
});
