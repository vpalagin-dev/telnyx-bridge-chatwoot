import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresOperationalStore } from '../../../src/persistence/postgres-operational-store.js';

describe('PostgresOperationalStore', () => {
  it('persists the returned conversation state when recording an AI outcome', async () => {
    const stateInsertParams: unknown[] = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: null, rows: [] };
        if (sql.includes('UPDATE telnyx_bridge.ai_decisions')) {
          const returnsState = sql.includes('RETURNING conversation_id,state');
          return { rowCount: 1, rows: [returnsState ? { conversation_id: 42, state: 'waiting_for_human' } : { conversation_id: 42 }] };
        }
        if (sql.includes('INSERT INTO telnyx_bridge.ai_conversation_state')) {
          stateInsertParams.push(...(params ?? []));
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    const store = new PostgresOperationalStore('postgres://unused', pool);

    await store.setAiDecisionOutcome('decision-1', {
      outcome: 'fallback',
      status: 'completed',
      state: 'waiting_for_human',
    });

    expect(stateInsertParams).toEqual([42, 'waiting_for_human']);
  });
});
