import { Pool } from 'pg';
import type { JamaContactRow } from './types.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

export type JamaContactsSourceOptions = {
  pool: Pool;
  schema: string;
  table: string;
};

export type JamaContactsSource = {
  fetchAfter(cursorUpdatedAt: Date, cursorContactId: number, limit: number): Promise<JamaContactRow[]>;
  close(): Promise<void>;
};

function quoteIdent(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error('Invalid SQL identifier for Jama contacts source');
  return `"${value.replace(/"/g, '""')}"`;
}

export function createJamaContactsSource(options: JamaContactsSourceOptions): JamaContactsSource {
  const qualified = `${quoteIdent(options.schema)}.${quoteIdent(options.table)}`;
  const sql = `
    SELECT contact_id, first_name, last_name, email, phone_e164, updated_at
    FROM ${qualified}
    WHERE phone_e164 IS NOT NULL
      AND trim(phone_e164) <> ''
      AND (updated_at, contact_id) > ($1, $2)
    ORDER BY updated_at ASC, contact_id ASC
    LIMIT $3`;

  return {
    async fetchAfter(cursorUpdatedAt, cursorContactId, limit) {
      const result = await options.pool.query<{
        contact_id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone_e164: string;
        updated_at: Date;
      }>(sql, [cursorUpdatedAt, cursorContactId, limit]);
      return result.rows.map((row) => ({
        contactId: Number(row.contact_id),
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phoneE164: row.phone_e164,
        updatedAt: row.updated_at,
      }));
    },
    close() {
      return options.pool.end();
    },
  };
}
