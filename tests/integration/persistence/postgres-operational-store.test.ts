import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresOperationalStore } from '../../../src/persistence/postgres-operational-store.js';
import { PostgresStore } from '../../../src/persistence/postgres-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('PostgresOperationalStore (disposable TEST_DATABASE_URL only)', () => {
  let pool: Pool;
  let store: PostgresOperationalStore;
  let receipts: PostgresStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    store = new PostgresOperationalStore(databaseUrl!);
    receipts = new PostgresStore(databaseUrl!);
    await store.initialize();
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS telnyx_bridge CASCADE');
    await pool.end();
    await store.close();
    await receipts.close();
  });

  it('atomically deduplicates events and outbound actions', async () => {
    const eventId = `event-${randomUUID()}`;
    expect(await Promise.all([store.claimEvent('telnyx', eventId), store.claimEvent('telnyx', eventId)]).then((values) => values.filter(Boolean))).toHaveLength(1);
    expect(await store.getEventStatus('telnyx', eventId)).toBe('processing');
    await store.setEventStatus('telnyx', eventId, 'completed');
    expect(await store.getEventStatus('telnyx', eventId)).toBe('completed');

    const actionId = `action-${randomUUID()}`;
    expect(await Promise.all([store.claimOutboundAction(actionId), store.claimOutboundAction(actionId)]).then((values) => values.filter(Boolean))).toHaveLength(1);
    await store.completeOutboundAction(actionId, 'msg-1');
    expect(await store.getOutboundAction(actionId)).toEqual({ status: 'sent', telnyxMessageId: 'msg-1' });
  });

  it('upserts suppression and conversation bindings', async () => {
    const phone = `+1555${Date.now()}`;
    await store.suppress(phone, 'stop-1');
    expect(await store.isSuppressed(phone)).toBe(true);
    await store.bindConversation(123456, phone);
    expect(await store.getPhoneForConversation(123456)).toBe(phone);
  });

  it('reuses AI decisions and persists history, submission, and state', async () => {
    const suffix = randomUUID();
    const input = { inboundIdentity: `inbound-${suffix}`, conversationId: 789, inboundMessageId: 456, eventId: `event-${suffix}`, aiDecisionId: `decision-${suffix}` };
    expect(await store.claimAiDecision(input)).toEqual({ claimed: true, decisionId: input.aiDecisionId });
    expect(await store.claimAiDecision(input)).toEqual({ claimed: false, decisionId: input.aiDecisionId, status: 'claimed' });
    expect(await store.ensureAiActive(input.conversationId)).toBe(true);
    await store.recordAiHistoryMessage(input.aiDecisionId, 999);
    await store.recordAiTelnyxSubmission(input.aiDecisionId, `action-${suffix}`, 'telnyx-1');
    const decision = await store.getAiDecision(input.aiDecisionId);
    expect(decision).toMatchObject({ chatwootHistoryMessageId: 999, telnyxActionId: `action-${suffix}`, telnyxMessageId: 'telnyx-1', status: 'completed' });
    expect(await store.isAiHistoryMessage(999)).toBe(true);
  });

  it('propagates escalation, fallback, provider, and validation outcomes to conversation state', async () => {
    const outcomes = [
      { outcome: 'escalated', state: 'waiting_for_human' },
      { outcome: 'fallback', state: 'waiting_for_human' },
      { outcome: 'provider_error', state: 'waiting_for_human' },
      { outcome: 'validation_error', state: 'waiting_for_human' },
    ] as const;

    for (const [index, result] of outcomes.entries()) {
      const suffix = randomUUID();
      const input = { inboundIdentity: `outcome-${suffix}`, conversationId: 10_000 + index, inboundMessageId: index, eventId: `event-${suffix}`, aiDecisionId: `decision-${suffix}` };
      expect(await store.claimAiDecision(input)).toEqual({ claimed: true, decisionId: input.aiDecisionId });
      await store.setAiDecisionOutcome(input.aiDecisionId, { ...result, status: 'completed' });
      expect(await store.getAiDecision(input.aiDecisionId)).toMatchObject({ outcome: result.outcome, state: result.state, status: 'completed' });
      const state = await pool.query<{ state: string }>('SELECT state FROM telnyx_bridge.ai_conversation_state WHERE conversation_id = $1', [input.conversationId]);
      expect(state.rows[0]?.state).toBe(result.state);
    }
  });

  it('serializes rate-limit claims atomically', async () => {
    const phone = `+1666${Date.now()}`;
    const results = await Promise.all([
      store.claimAiReplyAttempt(phone, 'decision-a', 1000, 0, 1, 60_000),
      store.claimAiReplyAttempt(phone, 'decision-b', 1000, 0, 1, 60_000),
    ]);
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
  });

  it('reclaims stale receipt leases and rejects the old worker', async () => {
    const inserted = await receipts.insertReceipt({ provider: 'telnyx', providerEventId: `stale-${randomUUID()}`, rawPayload: { stale: true } });
    expect(await receipts.claimReceipt(inserted.receiptId, 'worker-a', 1)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await receipts.claimReceipt(inserted.receiptId, 'worker-b', 1))?.lockedBy).toBe('worker-b');
    await expect(receipts.completeReceipt(inserted.receiptId, 'worker-a')).rejects.toThrow(/ownership/i);
    await receipts.completeReceipt(inserted.receiptId, 'worker-b');
  });
}, 30_000);

if (!databaseUrl) {
  describe('PostgresOperationalStore configuration', () => {
    it.skip('requires TEST_DATABASE_URL and never falls back to production credentials', () => {
      expect.fail('Set TEST_DATABASE_URL to run PostgreSQL integration tests');
    });
  });
}
