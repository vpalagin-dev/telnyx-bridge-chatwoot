import { normalizePhone } from '../domain/phone.js';

function tryNormalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

export function extractPhoneFromOutboundEvent(event: unknown): string | null {
  const root = event as Record<string, unknown>;
  const conversation = root.conversation as Record<string, unknown> | undefined;
  const meta = conversation?.meta as Record<string, unknown> | undefined;
  const metaSender = meta?.sender as Record<string, unknown> | undefined;
  const fromMeta = tryNormalizePhone(metaSender?.phone_number ?? metaSender?.phone);
  if (fromMeta) return fromMeta;

  const contact = root.contact as Record<string, unknown> | undefined;
  const fromContact = tryNormalizePhone(contact?.phone_number ?? contact?.phone);
  if (fromContact) return fromContact;

  return null;
}
