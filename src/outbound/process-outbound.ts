import { z } from 'zod';
import type { OperationalStore } from '../persistence/operational-store.js';
import type { TelnyxClient } from '../telnyx/client.js';

const outboundEventSchema = z.object({
  event: z.string(),
  id: z.union([z.string(), z.number()]),
  message_type: z.string(),
  private: z.boolean(),
  content: z.string(),
  account: z.object({ id: z.number() }),
  inbox: z.object({ id: z.number() }),
  conversation: z.object({ id: z.number() }),
  sender: z.object({ type: z.string() }),
}).passthrough();

type Dependencies = {
  store: OperationalStore;
  telnyx: TelnyxClient;
  accountId: number;
  inboxId: number;
  senderNumber: string;
  outboundMode: 'fake' | 'live';
  testRecipientNumber?: string;
};

export type OutboundResult =
  | { outcome: 'ignored'; actionId: string }
  | { outcome: 'recipient_mapping_needs_review' | 'recipient_not_allowlisted'; actionId: string }
  | { outcome: 'suppressed'; actionId: string }
  | { outcome: 'duplicate' | 'unknown_needs_review'; actionId: string }
  | { outcome: 'sent'; actionId: string; telnyxMessageId: string };

export async function processChatwootOutbound(input: unknown, dependencies: Dependencies): Promise<OutboundResult> {
  const event = outboundEventSchema.parse(input);
  const actionId = String(event.id);
  const marker = (event as any).custom_attributes?.ai_generated;
  if (marker === true || dependencies.store.isAiHistoryMessage(event.id)) return { outcome: 'ignored', actionId };
  if (marker !== undefined) return { outcome: 'unknown_needs_review', actionId };
  const hasForbiddenAutomationMarker =
    event.campaign_id != null ||
    event.automation_rule_id != null ||
    event.template_params != null ||
    (Array.isArray(event.attachments) && event.attachments.length > 0) ||
    (event.content_type != null && event.content_type !== 'text');
  const eligible =
    event.event === 'message_created' &&
    event.account.id === dependencies.accountId &&
    event.inbox.id === dependencies.inboxId &&
    event.message_type === 'outgoing' &&
    event.private === false &&
    event.sender.type === 'user' &&
    event.content.trim().length > 0 &&
    !hasForbiddenAutomationMarker;

  if (!eligible) return { outcome: 'ignored', actionId };

  const phone = dependencies.store.getPhoneForConversation(event.conversation.id);
  if (!phone) return { outcome: 'recipient_mapping_needs_review', actionId };
  if (dependencies.store.isSuppressed(phone)) return { outcome: 'suppressed', actionId };
  if (dependencies.outboundMode !== 'fake' && dependencies.outboundMode !== 'live') {
    throw new Error('OUTBOUND_MODE must be fake or live');
  }
  if (dependencies.outboundMode === 'live' && phone !== dependencies.testRecipientNumber) {
    return { outcome: 'recipient_not_allowlisted', actionId };
  }

  if (!dependencies.store.claimOutboundAction(actionId)) {
    const existing = dependencies.store.getOutboundAction(actionId);
    return {
      outcome: existing?.status === 'sent' ? 'duplicate' : 'unknown_needs_review',
      actionId,
    };
  }

  if (dependencies.outboundMode !== 'live') {
    const fakeMessageId = `fake-chatwoot-${actionId}`;
    dependencies.store.completeOutboundAction(actionId, fakeMessageId);
    return { outcome: 'sent', actionId, telnyxMessageId: fakeMessageId };
  }

  try {
    const response = await dependencies.telnyx.sendSms({
      from: dependencies.senderNumber,
      to: phone,
      text: event.content,
    });
    dependencies.store.completeOutboundAction(actionId, response.id);
    return { outcome: 'sent', actionId, telnyxMessageId: response.id };
  } catch (error) {
    dependencies.store.markOutboundUnknown(actionId);
    throw error;
  }
}
