import { createContactSyncService, type ContactSyncService } from './contact-sync.js';
import { createJamaContactsSource, type JamaContactsSource } from './jama-contacts-source.js';
import { createJamaContactsPool, jamaContactsPoolOptionsFromConfig } from './jama-contacts-pool.js';
import type { BridgeConfig } from '../config/env.js';
import type { HttpChatwootClient } from '../chatwoot/http-client.js';
import type { PostgresContactSyncStore } from '../persistence/postgres-contact-sync-store.js';
import { createLogger } from '../observability/logger.js';
import type { Pool } from 'pg';

export type ContactSyncRuntime = {
  contactSync: ContactSyncService;
  jamaContactsSource: JamaContactsSource;
  jamaContactsPool: Pool;
};

export async function bootstrapContactSync(options: {
  config: BridgeConfig;
  chatwoot: HttpChatwootClient;
  contactSyncStore: PostgresContactSyncStore;
}): Promise<ContactSyncRuntime> {
  const contactSyncConfig = options.config.contactSync;
  if (!contactSyncConfig?.enabled) throw new Error('contact sync is not enabled');
  const poolOptions = jamaContactsPoolOptionsFromConfig(contactSyncConfig);
  const jamaContactsPool = await createJamaContactsPool(poolOptions);
  const jamaContactsSource = createJamaContactsSource({
    pool: jamaContactsPool,
    schema: contactSyncConfig.schema,
    table: contactSyncConfig.table,
  });
  const contactSync = createContactSyncService({
    source: jamaContactsSource,
    store: options.contactSyncStore,
    chatwoot: options.chatwoot,
    batchSize: contactSyncConfig.batchSize,
    intervalMs: contactSyncConfig.intervalMs,
    delayMs: contactSyncConfig.delayMs,
    logger: createLogger(),
  });
  return { contactSync, jamaContactsSource, jamaContactsPool };
}
