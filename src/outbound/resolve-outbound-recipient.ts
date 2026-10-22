import type { ChatwootClient } from '../chatwoot/client.js';
import type { OperationalStore } from '../persistence/operational-store.js';
import { extractPhoneFromOutboundEvent } from './resolve-outbound-phone.js';

export async function resolveOutboundRecipientPhone(options: {
  conversationId: number;
  event: unknown;
  store: OperationalStore;
  chatwoot?: ChatwootClient;
}): Promise<string | null> {
  const bound = await options.store.getPhoneForConversation(options.conversationId);
  if (bound) return bound;

  const fromWebhook = extractPhoneFromOutboundEvent(options.event);
  if (fromWebhook) return fromWebhook;

  if (options.chatwoot) {
    return options.chatwoot.getConversationContactPhone(options.conversationId);
  }

  return null;
}
