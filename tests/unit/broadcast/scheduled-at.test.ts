import { describe, expect, it } from 'vitest';
import { parseBroadcastScheduledAt } from '../../../src/broadcast/scheduled-at.js';

describe('parseBroadcastScheduledAt', () => {
  it('prefers the browser UTC instant from scheduled_at_utc', () => {
    const parsed = parseBroadcastScheduledAt({
      scheduled_at_utc: '2026-10-22T16:20:00.000Z',
      scheduled_at: '2026-10-22T19:20',
    });
    expect(parsed?.toISOString()).toBe('2026-10-22T16:20:00.000Z');
  });

  it('falls back to scheduled_at when utc is missing', () => {
    const parsed = parseBroadcastScheduledAt({ scheduled_at: '2026-10-22T19:20:00.000Z' });
    expect(parsed?.toISOString()).toBe('2026-10-22T19:20:00.000Z');
  });
});
