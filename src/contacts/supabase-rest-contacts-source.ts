import type { JamaContactRow } from './types.js';
import type { JamaContactsSource } from './jama-contacts-source.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type SupabaseRestContactsSourceOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  schema: string;
  table: string;
  fetcher?: Fetcher;
};

type RestContactRow = {
  contact_id: number | string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string | null;
  updated_at: string;
};

function assertIdent(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`Invalid ${label} for Supabase REST contacts source`);
}

function cursorFilter(cursorUpdatedAt: Date, cursorContactId: number): string {
  const iso = cursorUpdatedAt.toISOString();
  return `or(updated_at.gt.${iso},and(updated_at.eq.${iso},contact_id.gt.${cursorContactId}))`;
}

function mapRow(row: RestContactRow): JamaContactRow | null {
  const phone = row.phone_e164?.trim();
  if (!phone) return null;
  return {
    contactId: Number(row.contact_id),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phoneE164: phone,
    updatedAt: new Date(row.updated_at),
  };
}

export function createSupabaseRestContactsSource(options: SupabaseRestContactsSourceOptions): JamaContactsSource {
  assertIdent(options.schema, 'schema');
  assertIdent(options.table, 'table');
  const baseUrl = options.supabaseUrl.replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;

  return {
    async fetchAfter(cursorUpdatedAt, cursorContactId, limit) {
      const params = new URLSearchParams({
        select: 'contact_id,first_name,last_name,email,phone_e164,updated_at',
        order: 'updated_at.asc,contact_id.asc',
        limit: String(limit),
      });
      params.set('and', `(phone_e164.not.is.null,${cursorFilter(cursorUpdatedAt, cursorContactId)})`);

      const response = await fetcher(`${baseUrl}/rest/v1/${options.table}?${params.toString()}`, {
        headers: {
          apikey: options.serviceRoleKey,
          Authorization: `Bearer ${options.serviceRoleKey}`,
          Accept: 'application/json',
          'Accept-Profile': options.schema,
        },
      });
      if (!response.ok) {
        throw new Error(`Supabase REST contacts fetch failed with status ${response.status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error('Supabase REST contacts response was not an array');
      const rows: JamaContactRow[] = [];
      for (const entry of payload) {
        const mapped = mapRow(entry as RestContactRow);
        if (mapped) rows.push(mapped);
      }
      return rows;
    },
    async close() {
      return undefined;
    },
  };
}
