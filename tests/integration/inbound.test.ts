import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeOperationalStore } from '../helpers/fake-operational-store.js';
import { processTelnyxInbound } from '../../src/inbound/process-inbound.js';
import type { ChatwootClient, ChatwootContact, ChatwootConversation } from '../../src/chatwoot/client.js';

class FakeChatwoot implements ChatwootClient {
  calls: string[] = [];
  contact: ChatwootContact | null = null;
  conversation: ChatwootConversation | null = null;

  async findContactByPhone(phone: string) {
    this.calls.push(`find-contact:${phone}`);
    return this.contact;
  }
  async createContact(phone: string) {
    this.calls.push(`create-contact:${phone}`);
    return { id: 10, sourceId: 'source-10' };
  }
  async findConversation(contactId: number) {
    this.calls.push(`find-conversation:${contactId}`);
    return this.conversation;
  }
  async createConversation(contactId: number, sourceId: string) {
    this.calls.push(`create-conversation:${contactId}:${sourceId}`);
    return { id: 20, status: 'open' as const };
  }
  async reopenConversation(conversationId: number) {
    this.calls.push(`reopen-conversation:${conversationId}`);
  }
  async createIncomingMessage(conversationId: number, content: string) {
    this.calls.push(`create-message:${conversationId}:${content}`);
    return { id: 30 };
  }
}

const stores: FakeOperationalStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function fixture() {
  return JSON.parse(readFileSync(new URL('../fixtures/telnyx/message-received.json', import.meta.url), 'utf8'));
}

describe('processTelnyxInbound', () => {
  it('maps one inbound Telnyx fixture into one Chatwoot contact, conversation, and message', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const chatwoot = new FakeChatwoot();

    const result = await processTelnyxInbound(fixture(), {
      store,
      chatwoot,
      senderNumber: '+15551234567',
    });

    expect(result).toEqual({
      outcome: 'created',
      telnyxEventId: 'evt-inbound-1',
      telnyxMessageId: 'msg-inbound-1',
      chatwootConversationId: 20,
      chatwootMessageId: 30,
    });
    expect(store.getPhoneForConversation(20)).toBe('+14155552671');
    expect(chatwoot.calls).toEqual([
      'find-contact:+14155552671',
      'create-contact:+14155552671',
      'find-conversation:10',
      'create-conversation:10:source-10',
      'create-message:20:Hello from fixture',
    ]);
  });

  it('does not create a duplicate Chatwoot message for a repeated Telnyx event ID', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const chatwoot = new FakeChatwoot();

    await processTelnyxInbound(fixture(), { store, chatwoot, senderNumber: '+15551234567' });
    const duplicate = await processTelnyxInbound(fixture(), { store, chatwoot, senderNumber: '+15551234567' });

    expect(duplicate.outcome).toBe('duplicate');
    expect(chatwoot.calls.filter((call) => call.startsWith('create-message:'))).toHaveLength(1);
  });

  it('reopens a closed conversation before creating the incoming message', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const chatwoot = new FakeChatwoot();
    chatwoot.contact = { id: 10, sourceId: 'source-10' };
    chatwoot.conversation = { id: 21, status: 'resolved' };

    await processTelnyxInbound(fixture(), { store, chatwoot, senderNumber: '+15551234567' });

    expect(chatwoot.calls).toContain('reopen-conversation:21');
    expect(chatwoot.calls).toContain('create-message:21:Hello from fixture');
  });

  it('treats a stale processing claim as unknown instead of creating a message', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const chatwoot = new FakeChatwoot();
    store.claimEvent('telnyx', 'evt-inbound-1');

    const result = await processTelnyxInbound(fixture(), { store, chatwoot, senderNumber: '+15551234567' });

    expect(result.outcome).toBe('unknown_needs_review');
    expect(chatwoot.calls).toHaveLength(0);
  });

  it('allows retry after a pre-message Chatwoot lookup failure', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const chatwoot = new FakeChatwoot();
    let attempts = 0;
    chatwoot.findContactByPhone = async (phone) => {
      chatwoot.calls.push(`find-contact:${phone}`);
      attempts += 1;
      if (attempts === 1) throw new Error('Chatwoot unavailable');
      return { id: 10, sourceId: 'source-10' };
    };

    await expect(processTelnyxInbound(fixture(), { store, chatwoot, senderNumber: '+15551234567' }))
      .rejects.toThrow('Chatwoot unavailable');
    const retried = await processTelnyxInbound(fixture(), { store, chatwoot, senderNumber: '+15551234567' });

    expect(retried.outcome).toBe('created');
    expect(chatwoot.calls.filter((call) => call.startsWith('create-message:'))).toHaveLength(1);
  });

  it('records STOP before later outbound processing', async () => {
    const store = new FakeOperationalStore(':memory:');
    stores.push(store);
    const chatwoot = new FakeChatwoot();
    const stop = fixture();
    stop.data.id = 'evt-stop-1';
    stop.data.payload.id = 'msg-stop-1';
    stop.data.payload.text = ' STOP ';

    await processTelnyxInbound(stop, { store, chatwoot, senderNumber: '+15551234567' });

    expect(store.isSuppressed('+14155552671')).toBe(true);
  });
});
