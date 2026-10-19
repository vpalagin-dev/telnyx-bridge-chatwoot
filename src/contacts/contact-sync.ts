import { hashCrmContactPayload, mapJamaRowToChatwootPayload } from './map-contact-row.js';
import type { JamaContactsSource } from './jama-contacts-source.js';
import type { ContactSyncStore } from '../persistence/contact-sync-store.js';
import type { ChatwootClient } from '../chatwoot/client.js';

export type ContactSyncHandle = { stop(): Promise<void>; ready: Promise<void> };

export type ContactSyncService = {
  syncOnce(): Promise<{ processed: number; createdOrUpdated: number; skipped: number }>;
  start(): ContactSyncHandle;
};

type Logger = {
  info(data: object, message: string): void;
  error(data: object, message: string): void;
};

const defaultLogger: Logger = {
  info: () => undefined,
  error: () => undefined,
};

type Timer = ReturnType<typeof setTimeout>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createContactSyncService(options: {
  source: JamaContactsSource;
  store: ContactSyncStore;
  chatwoot: ChatwootClient;
  batchSize: number;
  intervalMs: number;
  delayMs: number;
  logger?: Logger;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): ContactSyncService {
  const logger = options.logger ?? defaultLogger;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let started = false;
  let timer: Timer | undefined;
  let running: Promise<void> | undefined;
  let handle: ContactSyncHandle | undefined;

  async function syncOnce(): Promise<{ processed: number; createdOrUpdated: number; skipped: number }> {
    const cursor = await options.store.getCursor();
    const rows = await options.source.fetchAfter(cursor.updatedAt, cursor.contactId, options.batchSize);
    let createdOrUpdated = 0;
    let skipped = 0;

    for (const row of rows) {
      let payload;
      try {
        payload = mapJamaRowToChatwootPayload(row);
      } catch {
        await options.store.setCursor({ updatedAt: row.updatedAt, contactId: row.contactId });
        skipped += 1;
        continue;
      }

      const contentHash = hashCrmContactPayload(payload);
      const existing = await options.store.getRecord(row.contactId);
      if (existing?.contentHash === contentHash) {
        await options.store.setCursor({ updatedAt: row.updatedAt, contactId: row.contactId });
        skipped += 1;
        continue;
      }

      const contact = await options.chatwoot.upsertCrmContact(payload);
      await options.store.saveRecord({
        sourceContactId: row.contactId,
        chatwootContactId: contact.id,
        contentHash,
        sourceUpdatedAt: row.updatedAt,
      });
      await options.store.setCursor({ updatedAt: row.updatedAt, contactId: row.contactId });
      createdOrUpdated += 1;
      if (options.delayMs > 0) await sleep(options.delayMs);
    }

    return { processed: rows.length, createdOrUpdated, skipped };
  }

  function schedule(): void {
    if (!started || timer !== undefined) return;
    timer = setTimeoutFn(() => {
      timer = undefined;
      void runAttempt();
    }, options.intervalMs);
  }

  async function runAttempt(): Promise<void> {
    if (!started || running !== undefined) return;
    running = syncOnce()
      .then((result) => {
        if (result.processed > 0) {
          logger.info(result, 'contact sync batch completed');
        }
      })
      .catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          { code: 'contact_sync_failed', errorName, errorMessage },
          `contact sync failed: ${errorMessage}`,
        );
      })
      .then(() => undefined);
    try {
      await running;
    } finally {
      running = undefined;
      schedule();
    }
  }

  async function stop(): Promise<void> {
    started = false;
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      timer = undefined;
    }
    if (running !== undefined) await running;
    handle = undefined;
  }

  return {
    syncOnce,
    start(): ContactSyncHandle {
      if (handle !== undefined) return handle;
      started = true;
      const ready = runAttempt();
      handle = { stop, ready };
      return handle;
    },
  };
}
