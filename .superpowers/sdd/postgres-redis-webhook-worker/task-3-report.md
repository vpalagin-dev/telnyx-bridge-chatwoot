# Task 3 Report: Redis Dispatch with PostgreSQL Recovery

## Implementation

- Added `src/persistence/redis-dispatch.ts` using the `redis` package and an injected `REDIS_URL` value.
- `RedisDispatch.publish(jobOrJobId)` publishes the job ID to a channel formed as `BRIDGE_REDIS_PREFIX + jobId`.
- `RedisDispatch.consume(handler)` subscribes only to the configured safe-character prefix, defers handler invocation with `Promise.resolve().then(...)`, removes failed handlers from dedupe, and resets setup state on failure.
- `RedisDispatch.close()` cleanly unsubscribes, closes both clients, clears seen IDs, and supports reuse.
- Publisher/subscriber errors are observed and recorded; Redis reconnect attempts are bounded so initial connection failures reject.
- Added `republishUndispatched`, which claims PostgreSQL outbox rows, publishes each row, and marks it dispatched only after a successful Redis acknowledgement while threading the lease duration through the mark. A publish failure leaves the PostgreSQL row undispatched for lease-based recovery.
- `PostgresStore.markOutboxDispatched` now requires the claim to belong to the dispatcher and remain within its lease.
- Added `startOutboxRecoveryLoop` with positive finite batch/lease/interval validation and protected error callbacks.
- No webhook route or worker changes were made.

## Tests and results

- RED verification: `npm exec vitest -- run tests/integration/persistence/redis-dispatch.test.ts` failed before implementation because `src/persistence/redis-dispatch.js` did not exist.
- Targeted persistence suite: `npm exec vitest -- run tests/integration/persistence/redis-dispatch.test.ts tests/integration/persistence/postgres-store.test.ts` — Redis configuration tests passed; live Redis/PostgreSQL tests skip clearly when `TEST_REDIS_URL` or `TEST_DATABASE_URL` is absent. No Railway credentials are used.
- Typecheck: `npm run typecheck` — passed.
- Full `npm test`: passed — 20 test files passed, 1 skipped; 105 tests passed and 19 skipped. PostgreSQL integration tests skipped because `TEST_DATABASE_URL` was absent.

## Limitations

- The duplicate-notification set is process-local and intentionally does not replace PostgreSQL receipt claiming; PostgreSQL remains authoritative for durable idempotency and recovery.
- Recovery publishes at least once. If PostgreSQL marking fails after Redis acknowledgement, the lease can expire and the job may be republished, which is expected durable outbox behavior.

## Commit

Review-fix commit: `30d653f` (`fix(queue): address task 3 review findings`).

## Verification update

- Report finalized after the review-fix commit; the full-suite result above is from the fresh `npm test` run in this session.

## Fix round 2

- `startOutboxRecoveryLoop` now awaits `Promise.resolve(options.onError?.(error))` inside the catch so asynchronous error-handler rejection is contained.
- `RedisDispatch.close()` attempts unsubscribe, subscriber quit, and publisher quit independently, while always resetting consumption flags and the seen-job set.
- Added regression coverage for async recovery-handler rejection and unsubscribe-failure cleanup/reuse.
- Typecheck: `npm run typecheck` — passed.
- Full `npm test`: passed — 21 test files passed, 1 skipped; 107 tests passed and 19 skipped.
- Commit: `fee7491` (`fix(queue): contain redis cleanup and recovery errors`).
