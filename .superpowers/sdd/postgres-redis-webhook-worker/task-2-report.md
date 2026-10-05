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

## Fix Round

- Added `claimed_by` and `claimed_at` outbox lease fields with idempotent schema migrations. `claimOutboxBatch(limit, dispatcherId, leaseDurationMs)` atomically claims rows using `FOR UPDATE SKIP LOCKED`, excludes active leases, and permits expired-lease recovery.
- `markOutboxDispatched(jobId, dispatcherId)` now requires current claim ownership and fails closed for stale or unknown dispatchers.
- Updated receipt transition interfaces to require `workerId`; completion, retry, and review updates require `status = 'processing'` plus matching `locked_by`, preventing stale workers from changing terminal state.
- Completion and transition outcomes persist only the allowlisted `result_code` values (`processed`, `retryable`, `needs_review`); raw result values are not accepted or stored.
- Added integration coverage for concurrent outbox assignment, lease recovery, stale receipt workers, and stale dispatchers. Cleanup reclaims expired leases between disposable-database tests.
- Removed literal EOF-style markers from the touched persistence/report artifacts.

## Fix Round Verification

- TDD RED: reviewer-expanded integration test/API expectations produced TypeScript signature and property failures before the store implementation was updated.
- Targeted integration suite: `npm exec vitest -- run tests/integration/persistence/postgres-store.test.ts` — skipped without `TEST_DATABASE_URL`; no production or Railway credential fallback.
- Typecheck: `npm exec -- tsc -p tsconfig.json --noEmit` — passed.
- Full suite: `npm test` — 97 passed, 10 skipped; 19 test files passed and the PostgreSQL integration file skipped because `TEST_DATABASE_URL` was absent.

## Fix Round 2: Completion Result Invariant

- Restricted `completeReceipt` to the `processed` result code; `retryable` and `needs_review` now fail before issuing any database update, so a completed status cannot carry a contradictory outcome.
- Added an integration regression covering both contradictory codes and asserting the receipt remains `processing` with no result code after rejection.
- Preserved the accepted at-least-once outbox lease design; no outbox behavior was changed.

## Fix Round 2 Verification

- TDD regression test was added before the production change. The targeted PostgreSQL suite could not execute against a database because `TEST_DATABASE_URL` was absent; it collected 11 tests and skipped all 11 without falling back to production or Railway credentials.
- Typecheck: `npm exec -- tsc -p tsconfig.json --noEmit` — passed.
- Full suite: `npm test` — 97 passed, 12 skipped; 19 test files passed and the PostgreSQL integration file skipped because `TEST_DATABASE_URL` was absent.
