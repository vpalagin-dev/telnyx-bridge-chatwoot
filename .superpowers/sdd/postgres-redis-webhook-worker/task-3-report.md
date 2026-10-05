# Task 3 Report: Redis Dispatch with PostgreSQL Recovery

## Implementation

- Added `src/persistence/redis-dispatch.ts` using the `redis` package and an injected `REDIS_URL` value.
- `RedisDispatch.publish(jobOrJobId)` publishes the job ID to a channel formed as `BRIDGE_REDIS_PREFIX + jobId`.
- `RedisDispatch.consume(handler)` subscribes only to the configured prefix, extracts job IDs, and suppresses duplicate notifications within the consumer process.
- `RedisDispatch.close()` cleanly unsubscribes and closes publisher/subscriber clients.
- Added `republishUndispatched`, which claims PostgreSQL outbox rows, publishes each row, and marks it dispatched only after a successful Redis acknowledgement. A publish failure leaves the PostgreSQL row undispatched for lease-based recovery.
- Added `startOutboxRecoveryLoop` with configurable batch size, lease duration, interval, dispatcher ID, and error callback.
- No webhook route or worker changes were made.

## Tests and results

- RED verification: `npm exec vitest -- run tests/integration/persistence/redis-dispatch.test.ts` failed before implementation because `src/persistence/redis-dispatch.js` did not exist.
- Targeted integration suite: `npm exec vitest -- run tests/integration/persistence/redis-dispatch.test.ts` — tests skip clearly when `TEST_REDIS_URL` is absent; no Railway credentials are used. Live Redis execution requires a disposable `TEST_REDIS_URL`.
- Typecheck: `npm run typecheck` — passed.
- Full `npm test`: passed — 19 test files passed, 2 skipped; 97 tests passed and 16 skipped. Redis and PostgreSQL integration suites skipped because `TEST_REDIS_URL` and `TEST_DATABASE_URL` were absent.

## Limitations

- The duplicate-notification set is process-local and intentionally does not replace PostgreSQL receipt claiming; PostgreSQL remains authoritative for durable idempotency and recovery.
- Recovery publishes at least once. If PostgreSQL marking fails after Redis acknowledgement, the lease can expire and the job may be republished, which is expected durable outbox behavior.

## Commit

Implementation commit: `5fdabae` (`feat(queue): add redis dispatch with postgres recovery`).

## Verification update

- Report finalized after the implementation commit; the full-suite result above is from the fresh `npm test` run in this session.
