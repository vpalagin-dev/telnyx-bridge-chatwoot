import type { OperationalStore } from '../persistence/operational-store.js';

export type AiReplyLimitConfig = {
  debounceMs: number;
  limit: number;
  windowMs: number;
};

export type AiReplyLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'suppressed' | 'debounced' | 'quota_exhausted'; retryAt?: number };

export const DEFAULT_AI_REPLY_LIMITS: AiReplyLimitConfig = {
  debounceMs: 15_000,
  limit: 10,
  windowMs: 86_400_000,
};

export class AiReplyRateLimiter {
  constructor(
    private readonly store: OperationalStore,
    private readonly config: AiReplyLimitConfig = DEFAULT_AI_REPLY_LIMITS,
  ) {}

  async check(phone: string, now = Date.now()): Promise<AiReplyLimitDecision> {
    const lastReplyAt = await this.store.getLastAiReplyAt(phone);
    if (lastReplyAt !== null && now - lastReplyAt < this.config.debounceMs) {
      return { allowed: false, reason: 'debounced', retryAt: lastReplyAt + this.config.debounceMs };
    }

    const count = await this.store.countAiRepliesSince(phone, now - this.config.windowMs);
    if (count >= this.config.limit) {
      return { allowed: false, reason: 'quota_exhausted' };
    }

    return { allowed: true };
  }

  async record(phone: string, aiDecisionId: string, sentAt = Date.now()): Promise<void> {
    await this.store.recordAiReply(phone, aiDecisionId, sentAt);
  }

  async claim(phone: string, aiDecisionId: string, now = Date.now()): Promise<AiReplyLimitDecision> {
    return this.store.claimAiReplyAttempt(
      phone,
      aiDecisionId,
      now,
      this.config.debounceMs,
      this.config.limit,
      this.config.windowMs,
    );
  }
}
