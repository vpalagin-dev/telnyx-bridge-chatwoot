import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeStore } from '../../../src/db/store.js';
import { AiReplyRateLimiter } from '../../../src/ai/rate-limit.js';

const stores: BridgeStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

describe('AiReplyRateLimiter', () => {
  it('allows the first reply and debounces a second reply for the same phone', () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const limiter = new AiReplyRateLimiter(store, { debounceMs: 15_000, limit: 10, windowMs: 86_400_000 });

    expect(limiter.check('+14155552671', 100_000)).toEqual({ allowed: true });
    limiter.record('+14155552671', 'ai-1', 100_000);
    expect(limiter.check('+14155552671', 110_000)).toEqual({
      allowed: false,
      reason: 'debounced',
      retryAt: 115_000,
    });
  });

  it('allows a new reply after debounce until the rolling quota is exhausted', () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const limiter = new AiReplyRateLimiter(store, { debounceMs: 15_000, limit: 2, windowMs: 86_400_000 });

    limiter.record('+14155552671', 'ai-1', 100_000);
    expect(limiter.check('+14155552671', 120_000)).toEqual({ allowed: true });
    limiter.record('+14155552671', 'ai-2', 120_000);
    expect(limiter.check('+14155552671', 140_000)).toEqual({ allowed: false, reason: 'quota_exhausted' });
  });

  it('expires old sends from the rolling window and persists records across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-rate-limit-'));
    const databasePath = join(directory, 'bridge.sqlite');
    const first = new BridgeStore(databasePath);
    const limiter = new AiReplyRateLimiter(first, { debounceMs: 0, limit: 1, windowMs: 100 });

    limiter.record('+14155552671', 'ai-1', 1000);
    expect(limiter.check('+14155552671', 1050)).toEqual({ allowed: false, reason: 'quota_exhausted' });
    first.close();

    const reopened = new BridgeStore(databasePath);
    const reopenedLimiter = new AiReplyRateLimiter(reopened, { debounceMs: 0, limit: 1, windowMs: 100 });
    expect(reopenedLimiter.check('+14155552671', 1050)).toEqual({ allowed: false, reason: 'quota_exhausted' });
    expect(reopenedLimiter.check('+14155552671', 1101)).toEqual({ allowed: true });
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('atomically blocks a final send attempt after STOP suppression', () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const limiter = new AiReplyRateLimiter(store, { debounceMs: 0, limit: 10, windowMs: 86_400_000 });

    store.suppress('+14155552671', 'stop-event-1');

    expect(limiter.claim('+14155552671', 'ai-stop-race', 2000)).toEqual({ allowed: false, reason: 'suppressed' });
    expect(store.countAiRepliesSince('+14155552671', 0)).toBe(0);
  });

  it('keeps quotas independent per phone', () => {
    const store = new BridgeStore(':memory:');
    stores.push(store);
    const limiter = new AiReplyRateLimiter(store, { debounceMs: 0, limit: 1, windowMs: 86_400_000 });

    limiter.record('+14155552671', 'ai-1', 1000);
    expect(limiter.check('+14155552671', 2000)).toEqual({ allowed: false, reason: 'quota_exhausted' });
    expect(limiter.check('+14155550000', 2000)).toEqual({ allowed: true });
  });
});
