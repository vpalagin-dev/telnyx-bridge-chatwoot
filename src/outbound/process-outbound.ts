import { z } from 'zod';
import type { ChatwootClient } from '../chatwoot/client.js';
import type { OperationalStore } from '../persistence/operational-store.js';
import type { TelnyxClient } from '../telnyx/client.js';
import { resolveOutboundRecipientPhone } from './resolve-outbound-recipient.js';

const outboundEventSchema = z.object({
  event: z.string(),
  id: z.union([z.string(), z.number()]),
  message_type: z.string(),
  private: z.boolean(),
  content: z.string(),
  account: z.object({ id: z.number() }),
  inbox: z.object({ id: z.number() }),
  conversation: z.object({ id: z.number() }).passthrough(),
  sender: z.object({ type: z.string() }),
}).passthrough();

type Dependencies = {
  store: OperationalStore;
  telnyx: TelnyxClient;
  chatwoot?: ChatwootClient;
  accountId: number;
  inboxId: number;
  senderNumber: string;
  outboundMode: 'fake' | 'live';
  testRecipientNumber?: string;
  campaignDelayMs?: number;
};

export type OutboundResult =
  | { outcome: 'ignored'; actionId: string }
  | { outcome: 'recipient_mapping_needs_review' | 'recipient_not_allowlisted'; actionId: string }
  | { outcome: 'suppressed'; actionId: string }
  | { outcome: 'duplicate' | 'unknown_needs_review'; actionId: string }
  | { outcome: 'sent'; actionId: string; telnyxMessageId: string };

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOutboundEligible(event: z.infer<typeof outboundEventSchema> & Record<string, unknown>): boolean {
  const isCampaign = event.campaign_id != null;
  const baseEligible =
    event.event === 'message_created' &&
    event.message_type === 'outgoing' &&
    event.private === false &&
    event.content.trim().length > 0;

  if (!baseEligible) return false;

  const automationBlocked =
    event.automation_rule_id != null ||
    (!isCampaign && event.template_params != null) ||
    (Array.isArray(event.attachments) && event.attachments.length > 0) ||
    (event.content_type != null && event.content_type !== 'text');

  if (automationBlocked) return false;

  if (isCampaign) {
    return event.sender.type === 'user' || event.sender.type === 'agent_bot';
  }

  return event.sender.type === 'user' && event.campaign_id == null;
}

export async function processChatwootOutbound(input: unknown, dependencies: Dependencies): Promise<OutboundResult> {
  const event = outboundEventSchema.parse(input);
  const actionId = String(event.id);
  const rawEvent = event as z.infer<typeof outboundEventSchema> & Record<string, unknown>;
  const marker = (event as any).custom_attributes?.ai_generated;
  if (marker === true || await dependencies.store.isAiHistoryMessage(event.id)) return { outcome: 'ignored', actionId };
  if (marker !== undefined) return { outcome: 'unknown_needs_review', actionId };

  const eligible =
    rawEvent.account.id === dependencies.accountId &&
    rawEvent.inbox.id === dependencies.inboxId &&
    isOutboundEligible(rawEvent);

  if (!eligible) return { outcome: 'ignored', actionId };

  const phone = await resolveOutboundRecipientPhone({
    conversationId: event.conversation.id,
    event: rawEvent,
    store: dependencies.store,
    ...(dependencies.chatwoot ? { chatwoot: dependencies.chatwoot } : {}),
  });
  if (!phone) return { outcome: 'recipient_mapping_needs_review', actionId };
  if (await dependencies.store.isSuppressed(phone)) return { outcome: 'suppressed', actionId };
  if (dependencies.outboundMode !== 'fake' && dependencies.outboundMode !== 'live') {
    throw new Error('OUTBOUND_MODE must be fake or live');
  }
  if (
    dependencies.outboundMode === 'live'
    && dependencies.testRecipientNumber
    && phone !== dependencies.testRecipientNumber
  ) {
    return { outcome: 'recipient_not_allowlisted', actionId };
  }

  if (!(await dependencies.store.claimOutboundAction(actionId))) {
    const existing = await dependencies.store.getOutboundAction(actionId);
    return {
      outcome: existing?.status === 'sent' ? 'duplicate' : 'unknown_needs_review',
      actionId,
    };
  }

  await dependencies.store.bindConversation(event.conversation.id, phone);

  const isCampaign = rawEvent.campaign_id != null;
  const campaignDelayMs = dependencies.campaignDelayMs ?? 0;
  if (isCampaign && campaignDelayMs > 0) {
    await delay(campaignDelayMs);
  }

  if (dependencies.outboundMode !== 'live') {
    const fakeMessageId = `fake-chatwoot-${actionId}`;
    await dependencies.store.completeOutboundAction(actionId, fakeMessageId);
    return { outcome: 'sent', actionId, telnyxMessageId: fakeMessageId };
  }

  try {
    const response = await dependencies.telnyx.sendSms({
      from: dependencies.senderNumber,
      to: phone,
      text: event.content,
    });
    await dependencies.store.completeOutboundAction(actionId, response.id);
    return { outcome: 'sent', actionId, telnyxMessageId: response.id };
  } catch (error) {
    await dependencies.store.markOutboundUnknown(actionId);
    throw error;
  }
}
