import { z } from 'zod';
import type { ChatwootClient } from '../chatwoot/client.js';
import type { BridgeStore } from '../db/store.js';
import type { AiProcessResult } from '../ai/types.js';
import { normalizePhone } from '../domain/phone.js';
import { classifyConsentCommand } from '../domain/suppression.js';

const inboundEventSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    event_type: z.literal('message.received'),
    payload: z.object({
      id: z.string().min(1),
      direction: z.literal('inbound'),
      type: z.literal('SMS'),
      from: z.object({ phone_number: z.string().min(1) }),
      to: z.array(z.object({ phone_number: z.string().min(1) })).min(1),
      text: z.string(),
    }),
  }),
});

type Dependencies = {
  store: BridgeStore;
  chatwoot: ChatwootClient;
  senderNumber: string;
  postInbound?: (input: { inboundIdentity: string; telnyxEventId: string; telnyxMessageId: string; conversationId: number; inboundMessageId: number; recipient: string; customerMessage: string }) => Promise<AiProcessResult>;
};

export type InboundResult =
  | { outcome: 'duplicate' | 'unknown_needs_review' | 'ignored'; telnyxEventId: string }
  | {
      outcome: 'created';
      telnyxEventId: string;
      telnyxMessageId: string;
      chatwootConversationId: number;
      chatwootMessageId: number;
    };

export async function processTelnyxInbound(input: unknown, dependencies: Dependencies): Promise<InboundResult> {
  const event = inboundEventSchema.parse(input);
  const { data } = event;
  const existingStatus = dependencies.store.getEventStatus('telnyx', data.id);
  if (existingStatus) {
    return {
      outcome: existingStatus === 'completed' ? 'duplicate' : 'unknown_needs_review',
      telnyxEventId: data.id,
    };
  }

  if (!data.payload.to.some((recipient) => normalizePhone(recipient.phone_number) === dependencies.senderNumber)) {
    dependencies.store.claimEvent('telnyx', data.id);
    dependencies.store.setEventStatus('telnyx', data.id, 'completed');
    return { outcome: 'ignored', telnyxEventId: data.id };
  }

  const phone = normalizePhone(data.payload.from.phone_number);
  if (classifyConsentCommand(data.payload.text) === 'opt_out') {
    dependencies.store.suppress(phone, data.id);
  }

  let contact = await dependencies.chatwoot.findContactByPhone(phone);
  contact ??= await dependencies.chatwoot.createContact(phone);

  let conversation = await dependencies.chatwoot.findConversation(contact.id);
  if (!conversation) {
    conversation = await dependencies.chatwoot.createConversation(contact.id, contact.sourceId);
  } else if (conversation.status === 'resolved') {
    await dependencies.chatwoot.reopenConversation(conversation.id);
  }

  if (!dependencies.store.claimEvent('telnyx', data.id)) {
    return { outcome: 'duplicate', telnyxEventId: data.id };
  }

  dependencies.store.bindConversation(conversation.id, phone);
  try {
    const message = await dependencies.chatwoot.createIncomingMessage(conversation.id, data.payload.text);
    dependencies.store.setEventStatus('telnyx', data.id, 'completed');
    if (dependencies.postInbound) {
      try { await dependencies.postInbound({ inboundIdentity: data.payload.id, telnyxEventId: data.id, telnyxMessageId: data.payload.id, conversationId: conversation.id, inboundMessageId: message.id, recipient: phone, customerMessage: data.payload.text }); } catch { /* AI failure is isolated from inbound ACK */ }
    }
    return {
      outcome: 'created',
      telnyxEventId: data.id,
      telnyxMessageId: data.payload.id,
      chatwootConversationId: conversation.id,
      chatwootMessageId: message.id,
    };
  } catch (error) {
    dependencies.store.setEventStatus('telnyx', data.id, 'unknown_needs_review');
    throw error;
  }
}
