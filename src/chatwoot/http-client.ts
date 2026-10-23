import type { ChatwootCrmContactPayload } from '../contacts/types.js';
import { normalizePhone } from '../domain/phone.js';
import type { ChatwootHistoryMessage } from '../ai/conversation-history.js';
import type { ChatwootClient, ChatwootContact, ChatwootConversation, ChatwootAiHistoryWriter, AiHistoryMetadata } from './client.js';

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type Fetcher = (url: string, init?: RequestInit) => Promise<FetchResponse>;

type Options = {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  apiToken: string;
  fetcher?: Fetcher;
};

function inboxIdOf(entry: any): number | undefined {
  const value = entry?.inbox_id ?? entry?.inbox?.id;
  return typeof value === 'number' ? value : Number(value) || undefined;
}

function inboxBinding(source: any, inboxId: number): { source_id: string } | undefined {
  if (source?.contact_inbox && inboxIdOf(source.contact_inbox) === inboxId && source.contact_inbox.source_id) {
    return source.contact_inbox;
  }
  const entries = Array.isArray(source?.contact_inboxes) ? source.contact_inboxes : [];
  return entries.find((entry: any) => inboxIdOf(entry) === inboxId && entry?.source_id);
}


function parseChatwootHistoryMessage(entry: unknown): ChatwootHistoryMessage | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const candidate = entry as Record<string, unknown>;
  if (typeof candidate.id !== 'number' || typeof candidate.content !== 'string') return null;
  const messageType = parseChatwootMessageType(candidate.message_type);
  if (!messageType) return null;
  const createdAt = parseChatwootCreatedAt(candidate.created_at);
  if (createdAt === null) return null;
  return {
    id: candidate.id,
    content: candidate.content,
    messageType,
    private: candidate.private === true,
    createdAt,
  };
}

function parseChatwootMessageType(value: unknown): 'incoming' | 'outgoing' | null {
  if (value === 0 || value === 'incoming') return 'incoming';
  if (value === 1 || value === 'outgoing') return 'outgoing';
  return null;
}

function parseChatwootCreatedAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export class HttpChatwootClient implements ChatwootClient, ChatwootAiHistoryWriter {
  readonly #options: Options;
  readonly #fetcher: Fetcher;

  constructor(options: Options) {
    this.#options = options;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async #request(path: string, init: RequestInit = {}): Promise<any> {
    const response = await this.#fetcher(`${this.#options.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        api_access_token: this.#options.apiToken,
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Chatwoot request failed with status ${response.status}`);
    return response.json();
  }

  async #searchContacts(query: string): Promise<any[]> {
    const data = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/contacts/search?q=${encodeURIComponent(query)}`,
    );
    return Array.isArray(data.payload) ? data.payload : [];
  }

  async #ensureInboxBinding(contact: any): Promise<ChatwootContact> {
    const existingInbox = inboxBinding(contact, this.#options.inboxId);
    if (existingInbox?.source_id) return { id: contact.id, sourceId: existingInbox.source_id };
    const attached = await this.#request(`/api/v1/accounts/${this.#options.accountId}/contacts/${contact.id}/contact_inboxes`, {
      method: 'POST',
      body: JSON.stringify({ inbox_id: this.#options.inboxId }),
    });
    const sourceId = attached?.source_id ?? attached?.payload?.source_id ?? inboxBinding(attached, this.#options.inboxId)?.source_id;
    if (!sourceId) throw new Error('Chatwoot contact inbox attach lacked source_id');
    return { id: contact.id, sourceId };
  }

  #contactFromCreateResponse(data: any): ChatwootContact {
    const contact = data.payload?.contact ?? data.payload ?? data;
    const contactInbox =
      inboxBinding(contact, this.#options.inboxId) ??
      inboxBinding(data.payload, this.#options.inboxId) ??
      inboxBinding(data, this.#options.inboxId);
    if (!contactInbox?.source_id) throw new Error('Chatwoot contact response lacked the configured inbox binding');
    return { id: contact.id, sourceId: contactInbox.source_id };
  }

  async findContactByPhone(phone: string): Promise<ChatwootContact | null> {
    const contacts = await this.#searchContacts(phone);
    const contact = contacts.find((candidate: any) => {
      try {
        return normalizePhone(candidate.phone_number ?? candidate.phone ?? '') === phone;
      } catch {
        return false;
      }
    });
    if (!contact) return null;
    return this.#ensureInboxBinding(contact);
  }

  async findContactByIdentifier(identifier: string): Promise<ChatwootContact | null> {
    const contacts = await this.#searchContacts(identifier);
    const contact = contacts.find((candidate: any) => String(candidate.identifier ?? '') === identifier);
    if (!contact) return null;
    return this.#ensureInboxBinding(contact);
  }

  async createContact(phone: string): Promise<ChatwootContact> {
    const data = await this.#request(`/api/v1/accounts/${this.#options.accountId}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ name: phone, phone_number: phone, inbox_id: this.#options.inboxId }),
    });
    return this.#contactFromCreateResponse(data);
  }

  async #updateCrmContact(contactId: number, payload: ChatwootCrmContactPayload): Promise<void> {
    const body: Record<string, string> = {
      name: payload.name,
      phone_number: payload.phone,
      identifier: payload.identifier,
    };
    if (payload.email) body.email = payload.email;
    await this.#request(`/api/v1/accounts/${this.#options.accountId}/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async upsertCrmContact(payload: ChatwootCrmContactPayload): Promise<ChatwootContact> {
    const existing =
      (await this.findContactByIdentifier(payload.identifier))
      ?? (await this.findContactByPhone(payload.phone));
    if (existing) {
      await this.#updateCrmContact(existing.id, payload);
      return this.#ensureInboxBinding({
        id: existing.id,
        contact_inboxes: existing.sourceId
          ? [{ inbox_id: this.#options.inboxId, source_id: existing.sourceId }]
          : [],
      });
    }
    const body: Record<string, string | number> = {
      inbox_id: this.#options.inboxId,
      name: payload.name,
      phone_number: payload.phone,
      identifier: payload.identifier,
    };
    if (payload.email) body.email = payload.email;
    const data = await this.#request(`/api/v1/accounts/${this.#options.accountId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.#contactFromCreateResponse(data);
  }

  async findConversation(contactId: number): Promise<ChatwootConversation | null> {
    const data = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/contacts/${contactId}/conversations`,
    );
    const conversations = Array.isArray(data.payload)
      ? data.payload
      : Array.isArray(data.data?.payload)
        ? data.data.payload
        : [];
    const conversation = conversations.find((entry: { inbox_id?: number; inbox?: { id?: number } }) => {
      const inboxId = entry.inbox_id ?? entry.inbox?.id;
      return Number(inboxId) === this.#options.inboxId;
    });
    return conversation ? { id: conversation.id, status: conversation.status } : null;
  }

  async createConversation(contactId: number, sourceId: string): Promise<ChatwootConversation> {
    const conversation = await this.#request(`/api/v1/accounts/${this.#options.accountId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, source_id: sourceId, inbox_id: this.#options.inboxId, status: 'open' }),
    });
    return { id: conversation.id, status: conversation.status };
  }

  async reopenConversation(conversationId: number): Promise<void> {
    await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/conversations/${conversationId}/toggle_status`,
      { method: 'POST', body: JSON.stringify({ status: 'open' }) },
    );
  }

  async createIncomingMessage(conversationId: number, content: string): Promise<{ id: number }> {
    const message = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/conversations/${conversationId}/messages`,
      { method: 'POST', body: JSON.stringify({ content, message_type: 'incoming', private: false }) },
    );
    return { id: message.id };
  }

  async getConversationContactPhone(conversationId: number): Promise<string | null> {
    try {
      const data = await this.#request(
        `/api/v1/accounts/${this.#options.accountId}/conversations/${conversationId}`,
      );
      const meta = data?.meta as Record<string, unknown> | undefined;
      const sender = meta?.sender as Record<string, unknown> | undefined;
      const raw = sender?.phone_number ?? sender?.phone;
      if (typeof raw !== 'string' || !raw.trim()) return null;
      return normalizePhone(raw);
    } catch {
      return null;
    }
  }

  async listConversationMessages(conversationId: number): Promise<ChatwootHistoryMessage[]> {
    const data = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/conversations/${conversationId}/messages`,
    );
    const payload = Array.isArray(data?.payload) ? data.payload : [];
    const messages: ChatwootHistoryMessage[] = [];
    for (const entry of payload) {
      const parsed = parseChatwootHistoryMessage(entry);
      if (parsed) messages.push(parsed);
    }
    return messages;
  }

  async createAiHistoryMessage(conversationId: number, text: string, metadata: AiHistoryMetadata): Promise<{ id: number }> {
    const message = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/conversations/${conversationId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: text, message_type: 'outgoing', private: false, custom_attributes: metadata }) },
    );
    if (typeof message?.id !== 'number') throw new Error('Chatwoot AI history response lacked an id');
    return { id: message.id };
  }
}
