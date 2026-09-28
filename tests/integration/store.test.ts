import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeStore } from '../../src/db/store.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('BridgeStore', () => {
  it('deduplicates provider events and Chatwoot actions', () => {
    const store = new BridgeStore(':memory:');

    expect(store.claimEvent('telnyx', 'event-1')).toBe(true);
    expect(store.claimEvent('telnyx', 'event-1')).toBe(false);
    expect(store.claimOutboundAction('chatwoot-message-1')).toBe(true);
    expect(store.claimOutboundAction('chatwoot-message-1')).toBe(false);

    store.close();
  });

  it('persists suppression across database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'telnyx-bridge-'));
    directories.push(directory);
    const databasePath = join(directory, 'bridge.sqlite');

    const first = new BridgeStore(databasePath);
    first.suppress('+14155552671', 'event-1');
    first.close();

    const reopened = new BridgeStore(databasePath);
    expect(reopened.isSuppressed('+14155552671')).toBe(true);
    reopened.close();
  });
});
