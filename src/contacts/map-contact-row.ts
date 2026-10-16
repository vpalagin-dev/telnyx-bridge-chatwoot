import { createHash } from 'node:crypto';
import { normalizePhone } from '../domain/phone.js';
import type { ChatwootCrmContactPayload, JamaContactRow } from './types.js';

export function buildContactDisplayName(firstName: string | null, lastName: string | null): string {
  const parts = [firstName?.trim(), lastName?.trim()].filter((part): part is string => Boolean(part));
  return parts.join(' ') || 'Unknown';
}

export function mapJamaRowToChatwootPayload(row: JamaContactRow): ChatwootCrmContactPayload {
  const phone = normalizePhone(row.phoneE164);
  const payload: ChatwootCrmContactPayload = {
    phone,
    name: buildContactDisplayName(row.firstName, row.lastName),
    identifier: String(row.contactId),
  };
  const email = row.email?.trim();
  if (email) payload.email = email;
  return payload;
}

export function hashCrmContactPayload(payload: ChatwootCrmContactPayload): string {
  const stable = {
    phone: payload.phone,
    name: payload.name,
    identifier: payload.identifier,
    email: payload.email ?? null,
  };
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex');
}
