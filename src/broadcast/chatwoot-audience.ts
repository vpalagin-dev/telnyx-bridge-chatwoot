import { normalizePhone } from '../domain/phone.js';
import type { BroadcastLabel, ChatwootAudienceClient } from './types.js';

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type Options = {
  baseUrl: string;
  accountId: number;
  apiToken: string;
  fetcher?: Fetcher;
};

function inboxIdOf(entry: Record<string, unknown>): number | undefined {
  const inbox = entry.inbox as { id?: number } | undefined;
  const value = entry.inbox_id ?? inbox?.id;
  return typeof value === 'number' ? value : Number(value) || undefined;
}

function labelTitles(contact: Record<string, unknown>): string[] {
  const labels = contact.labels;
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => {
    if (typeof label === 'string') return label;
    if (label && typeof label === 'object' && typeof (label as { title?: string }).title === 'string') {
      return (label as { title: string }).title;
    }
    return '';
  }).filter(Boolean);
}

export function createChatwootAudienceClient(options: Options): ChatwootAudienceClient {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function request(path: string): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, {
      headers: { api_access_token: options.apiToken, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`chatwoot_audience_http_${response.status}`);
    return response.json();
  }

  return {
    async listLabels(): Promise<BroadcastLabel[]> {
      const body = await request(`/api/v1/accounts/${options.accountId}/labels`) as { payload?: unknown };
      const payload = Array.isArray(body.payload) ? body.payload : [];
      return payload
        .map((entry) => (entry && typeof entry === 'object' && typeof (entry as { title?: string }).title === 'string'
          ? { title: (entry as { title: string }).title }
          : null))
        .filter((entry): entry is BroadcastLabel => entry !== null);
    },

    async listRecipientPhones(input: { inboxId: number; label?: string | null }): Promise<string[]> {
      const phones = new Set<string>();
      let page = 1;
      while (true) {
        const body = await request(
          `/api/v1/accounts/${options.accountId}/contacts?page=${page}&include_contact_inboxes=true`,
        ) as { payload?: unknown; meta?: { current_page?: number; total_pages?: number } };
        const contacts = Array.isArray(body.payload) ? body.payload : [];
        if (contacts.length === 0) break;

        for (const raw of contacts) {
          if (!raw || typeof raw !== 'object') continue;
          const contact = raw as Record<string, unknown>;
          const inboxes = Array.isArray(contact.contact_inboxes) ? contact.contact_inboxes : [];
          const onInbox = inboxes.some((entry) => inboxIdOf(entry as Record<string, unknown>) === input.inboxId);
          if (!onInbox) continue;
          if (input.label) {
            const titles = labelTitles(contact);
            if (!titles.includes(input.label)) continue;
          }
          const rawPhone = contact.phone_number ?? contact.phone;
          if (typeof rawPhone !== 'string' || !rawPhone.trim()) continue;
          try {
            phones.add(normalizePhone(rawPhone));
          } catch {
            continue;
          }
        }

        const totalPages = body.meta?.total_pages;
        if (totalPages !== undefined && page >= totalPages) break;
        page += 1;
        if (page > 500) break;
      }
      return [...phones];
    },
  };
}
