import { loadConfig } from '../src/config/env.ts';
import { normalizePhone } from '../src/domain/phone.ts';

const config = loadConfig(process.env);
const phone = normalizePhone(config.outbound.testRecipientNumber ?? '');
const base = config.chatwoot.url.replace(/\/$/, '');
const accountId = config.chatwoot.accountId;
const inboxId = config.chatwoot.inboxId;
const headers = {
  'content-type': 'application/json',
  api_access_token: config.chatwoot.apiToken,
};

function summarize(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body;
  const record = body as Record<string, unknown>;
  const parts = ['message', 'error', 'description'].flatMap((key) => {
    const value = record[key];
    return typeof value === 'string' ? [`${key}=${value}`] : [];
  });
  if (Array.isArray(record.attributes)) parts.push(`attributes=${record.attributes.join(',')}`);
  return parts.join('; ') || Object.keys(record).join(',');
}

async function probe(name: string, path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: 'non-json' }; }
  console.log(name, response.status, summarize(parsed));
  return { ok: response.ok, status: response.status, body: parsed };
}

const search = await probe('search', `/api/v1/accounts/${accountId}/contacts/search?q=${encodeURIComponent(phone)}`);
const contacts = Array.isArray(search.body?.payload) ? search.body.payload : [];
const contact = contacts.find((candidate: any) => {
  try { return normalizePhone(candidate.phone_number ?? '') === phone; } catch { return false; }
});
console.log('search_matches', contacts.length, 'phone_match', Boolean(contact), 'contact_id', contact?.id ?? null);

let contactId = contact?.id as number | undefined;
let sourceId = contact?.contact_inboxes?.find((entry: any) => (entry.inbox_id ?? entry.inbox?.id) === inboxId)?.source_id as string | undefined;
console.log('source_id_present', Boolean(sourceId));

if (contactId && !sourceId) {
  const attached = await probe('attach_inbox', `/api/v1/accounts/${accountId}/contacts/${contactId}/contact_inboxes`, {
    method: 'POST',
    body: JSON.stringify({ inbox_id: inboxId }),
  });
  sourceId = attached.body?.source_id ?? attached.body?.payload?.source_id;
  console.log('attached_source_present', Boolean(sourceId));
}

if (!contactId) {
  const created = await probe('create_contact', `/api/v1/accounts/${accountId}/contacts`, {
    method: 'POST',
    body: JSON.stringify({ name: 'JAMA fixture', phone_number: phone, inbox_id: inboxId }),
  });
  contactId = created.body?.payload?.contact?.id ?? created.body?.payload?.id ?? created.body?.id;
  sourceId = created.body?.payload?.contact_inbox?.source_id
    ?? created.body?.payload?.contact?.contact_inboxes?.[0]?.source_id
    ?? sourceId;
  console.log('created_contact_id', contactId ?? null, 'created_source_present', Boolean(sourceId));
}

const conversations = await probe(
  'list_conversations',
  `/api/v1/accounts/${accountId}/conversations?inbox_id=${inboxId}&contact_id=${contactId}&status=all`,
);

const listed = conversations.body?.data?.payload ?? conversations.body?.payload ?? conversations.body?.data;
console.log('conversation_list_type', Array.isArray(listed) ? `array:${listed.length}` : typeof listed);

if (contactId && sourceId) {
  const createdConversation = await probe('create_conversation', `/api/v1/accounts/${accountId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ contact_id: contactId, source_id: sourceId, inbox_id: inboxId, status: 'open' }),
  });
  const conversationId = createdConversation.body?.id ?? createdConversation.body?.payload?.id;
  console.log('conversation_id', conversationId ?? null);
  if (conversationId) {
    await probe('create_incoming_message', `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello from fixture', message_type: 'incoming', private: false }),
    });
  }
}
