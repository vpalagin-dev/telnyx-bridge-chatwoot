# Task 2 Report: PostgreSQL Durable Receipt and Outbox Store

## Implementation

- Added `src/persistence/schema.ts` with idempotent creation SQL for the bridge-owned `telnyx_bridge` schema, `webhook_receipts`, and `webhook_outbox` tables.
- Added `src/persistence/postgres-store.ts` using `pg.Pool`.
- Receipt insertion uses a PostgreSQL transaction, provider/provider-event deduplication, and creates the receipt plus outbox row atomically.
- Receipt claims use `FOR UPDATE SKIP LOCKED` and transition eligible pending/retryable rows to processing with worker lock metadata.
- Added completion, retry scheduling/attempt counting, review-required state, outbox batch claims, and dispatched marking.
- Added `@types/pg` for strict TypeScript compilation.
- Existing SQLite store was not modified.

## Tests and results

- RED verification: `npm exec vitest -- run tests/integration/persistence/postgres-store.test.ts` failed before implementation because `src/persistence/postgres-store.js` did not exist.
- Targeted integration test without a configured disposable database: `npm exec vitest -- run tests/integration/persistence/postgres-store.test.ts` — 6 tests skipped with `TEST_DATABASE_URL` absent. The test never falls back to a production/Railway credential.
- Typecheck: `npm exec -- tsc -p tsconfig.json --noEmit` — passed.
- Full suite: `npm test` — 97 passed, 7 skipped, 1 integration file skipped (PostgreSQL tests require `TEST_DATABASE_URL`).

## Concerns / limitations

- Live PostgreSQL execution was not possible in this environment because `TEST_DATABASE_URL` was not provided. Run the targeted suite against a disposable PostgreSQL instance before deployment.
- `claimOutboxBatch` locks rows only for the transaction duration; with the current schema (which has no claim/lease column), concurrent dispatchers may observe the same undispatched row after the transaction commits. PostgreSQL remains authoritative, and `markOutboxDispatched` is idempotent; a future task can add a dispatch lease if needed.
- The completion result is accepted by the API but the brief schema has no result column, so it is intentionally not persisted beyond the completed status/timestamp.

## Commit

Implementation commit: `08880af` (`feat(storage): add durable postgres webhook receipts`).
