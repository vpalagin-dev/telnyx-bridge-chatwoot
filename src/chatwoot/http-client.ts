import { normalizePhone } from '../domain/phone.js';
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

  async findContactByPhone(phone: string): Promise<ChatwootContact | null> {
    const data = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/contacts/search?q=${encodeURIComponent(phone)}`,
    );
    const contacts = Array.isArray(data.payload) ? data.payload : [];
    const contact = contacts.find((candidate: any) => {
      try {
        return normalizePhone(candidate.phone_number ?? candidate.phone ?? '') === phone;
      } catch {
        return false;
      }
    });
    if (!contact) return null;
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

  async createContact(phone: string): Promise<ChatwootContact> {
    const data = await this.#request(`/api/v1/accounts/${this.#options.accountId}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ name: phone, phone_number: phone, inbox_id: this.#options.inboxId }),
    });
    const contact = data.payload?.contact ?? data.payload ?? data;
    const contactInbox =
      inboxBinding(contact, this.#options.inboxId) ??
      inboxBinding(data.payload, this.#options.inboxId) ??
      inboxBinding(data, this.#options.inboxId);
    if (!contactInbox?.source_id) throw new Error('Chatwoot contact response lacked the configured inbox binding');
    return { id: contact.id, sourceId: contactInbox.source_id };
  }

  async findConversation(contactId: number): Promise<ChatwootConversation | null> {
    const data = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/conversations?inbox_id=${this.#options.inboxId}&contact_id=${contactId}&status=all`,
    );
    const conversations = Array.isArray(data.data?.payload) ? data.data.payload : Array.isArray(data.payload) ? data.payload : [];
    const conversation = conversations[0];
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

  async createAiHistoryMessage(conversationId: number, text: string, metadata: AiHistoryMetadata): Promise<{ id: number }> {
    const message = await this.#request(
      `/api/v1/accounts/${this.#options.accountId}/conversations/${conversationId}/messages`,
      { method: 'POST', body: JSON.stringify({ content: text, message_type: 'outgoing', private: false, custom_attributes: metadata }) },
    );
    if (typeof message?.id !== 'number') throw new Error('Chatwoot AI history response lacked an id');
    return { id: message.id };
  }
}
