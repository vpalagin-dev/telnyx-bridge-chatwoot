import { z } from 'zod';
import type { ChatwootClient } from '../chatwoot/client.js';
import type { OperationalStore } from '../persistence/operational-store.js';
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
  store: OperationalStore;
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
       aiResult?: AiProcessResult;
       aiError?: true;
    };

export async function processTelnyxInbound(input: unknown, dependencies: Dependencies): Promise<InboundResult> {
  const event = inboundEventSchema.parse(input);
  const { data } = event;
  const existingStatus = await dependencies.store.getEventStatus('telnyx', data.id);
  if (existingStatus) {
    return {
      outcome: existingStatus === 'completed' ? 'duplicate' : 'unknown_needs_review',
      telnyxEventId: data.id,
    };
  }

  if (!data.payload.to.some((recipient) => normalizePhone(recipient.phone_number) === dependencies.senderNumber)) {
    await dependencies.store.claimEvent('telnyx', data.id);
    await dependencies.store.setEventStatus('telnyx', data.id, 'completed');
    return { outcome: 'ignored', telnyxEventId: data.id };
  }

  const phone = normalizePhone(data.payload.from.phone_number);
  if (classifyConsentCommand(data.payload.text) === 'opt_out') {
    await dependencies.store.suppress(phone, data.id);
  }

  let contact = await dependencies.chatwoot.findContactByPhone(phone);
  contact ??= await dependencies.chatwoot.createContact(phone);

  let conversation = await dependencies.chatwoot.findConversation(contact.id);
  if (!conversation) {
    conversation = await dependencies.chatwoot.createConversation(contact.id, contact.sourceId);
  } else if (conversation.status === 'resolved') {
    await dependencies.chatwoot.reopenConversation(conversation.id);
  }

  if (!(await dependencies.store.claimEvent('telnyx', data.id))) {
    return { outcome: 'duplicate', telnyxEventId: data.id };
  }

  await dependencies.store.bindConversation(conversation.id, phone);
  try {
    const message = await dependencies.chatwoot.createIncomingMessage(conversation.id, data.payload.text);
    await dependencies.store.setEventStatus('telnyx', data.id, 'completed');
    let aiResult: AiProcessResult | undefined;
    let aiError: true | undefined;
    if (dependencies.postInbound) {
      try { aiResult = await dependencies.postInbound({ inboundIdentity: data.payload.id, telnyxEventId: data.id, telnyxMessageId: data.payload.id, conversationId: conversation.id, inboundMessageId: message.id, recipient: phone, customerMessage: data.payload.text }); } catch { aiError = true; }
    }
    return {
      outcome: 'created',
      telnyxEventId: data.id,
      telnyxMessageId: data.payload.id,
      chatwootConversationId: conversation.id,
      chatwootMessageId: message.id,
      ...(aiResult ? { aiResult } : {}),
      ...(aiError ? { aiError } : {}),
    };
  } catch (error) {
    await dependencies.store.setEventStatus('telnyx', data.id, 'unknown_needs_review');
    throw error;
  }
}
