import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class BridgeStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS processed_events (
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, event_id)
      );
      CREATE TABLE IF NOT EXISTS outbound_actions (
        action_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'submitting',
        telnyx_message_id TEXT,
        claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS suppressions (
        phone TEXT PRIMARY KEY,
        source_event_id TEXT NOT NULL,
        suppressed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS conversation_bindings (
        conversation_id INTEGER PRIMARY KEY,
        phone TEXT NOT NULL
      );
    `);
  }

  claimEvent(provider: 'telnyx' | 'chatwoot', eventId: string): boolean {
    const result = this.#database
      .prepare("INSERT OR IGNORE INTO processed_events (provider, event_id, status) VALUES (?, ?, 'processing')")
      .run(provider, eventId);
    return result.changes === 1;
  }

  getEventStatus(provider: 'telnyx' | 'chatwoot', eventId: string): string | null {
    const row = this.#database
      .prepare('SELECT status FROM processed_events WHERE provider = ? AND event_id = ?')
      .get(provider, eventId) as { status: string } | undefined;
    return row?.status ?? null;
  }

  setEventStatus(provider: 'telnyx' | 'chatwoot', eventId: string, status: 'completed' | 'unknown_needs_review'): void {
    this.#database
      .prepare('UPDATE processed_events SET status = ? WHERE provider = ? AND event_id = ?')
      .run(status, provider, eventId);
  }

  claimOutboundAction(actionId: string): boolean {
    const result = this.#database
      .prepare("INSERT OR IGNORE INTO outbound_actions (action_id, status) VALUES (?, 'submitting')")
      .run(actionId);
    return result.changes === 1;
  }

  getOutboundAction(actionId: string): { status: string; telnyxMessageId: string | null } | null {
    const row = this.#database
      .prepare('SELECT status, telnyx_message_id FROM outbound_actions WHERE action_id = ?')
      .get(actionId) as { status: string; telnyx_message_id: string | null } | undefined;
    return row ? { status: row.status, telnyxMessageId: row.telnyx_message_id } : null;
  }

  completeOutboundAction(actionId: string, telnyxMessageId: string): void {
    this.#database
      .prepare("UPDATE outbound_actions SET status = 'sent', telnyx_message_id = ? WHERE action_id = ?")
      .run(telnyxMessageId, actionId);
  }

  markOutboundUnknown(actionId: string): void {
    this.#database
      .prepare("UPDATE outbound_actions SET status = 'unknown_needs_review' WHERE action_id = ?")
      .run(actionId);
  }

  suppress(phone: string, sourceEventId: string): void {
    this.#database
      .prepare(`
        INSERT INTO suppressions (phone, source_event_id)
        VALUES (?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          source_event_id = excluded.source_event_id,
          suppressed_at = CURRENT_TIMESTAMP
      `)
      .run(phone, sourceEventId);
  }

  isSuppressed(phone: string): boolean {
    return this.#database.prepare('SELECT 1 FROM suppressions WHERE phone = ?').get(phone) !== undefined;
  }

  bindConversation(conversationId: number, phone: string): void {
    this.#database
      .prepare(`
        INSERT INTO conversation_bindings (conversation_id, phone)
        VALUES (?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET phone = excluded.phone
      `)
      .run(conversationId, phone);
  }

  getPhoneForConversation(conversationId: number): string | null {
    const row = this.#database
      .prepare('SELECT phone FROM conversation_bindings WHERE conversation_id = ?')
      .get(conversationId) as { phone: string } | undefined;
    return row?.phone ?? null;
  }

  close(): void {
    this.#database.close();
  }
}
