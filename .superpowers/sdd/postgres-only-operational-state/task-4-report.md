# Task 4 Report — Crash-safe Redis dispatch and lease-aware worker

## Implemented

- Added PostgreSQL outbox publication state separate from receipt worker state: `published_at`, `publication_claimed_by`, and `publication_claimed_at`, including upgrade-safe `ALTER TABLE` statements.
- Added `PostgresStore.claimOutboxPublicationBatch` and `markOutboxPublished` with publication owner and lease predicates. Existing Task 3 method names remain compatibility aliases.
- Publication recovery only selects receipts that are not terminal (`completed`/`needs_review`), so completed work is not republished.
- Redis recovery now claims publication leases, publishes notifications, and marks publication only after Redis acknowledgement. A process crash between those steps leaves an expired publication lease that a later recovery pass can reclaim.
- Preserved awaited Redis callbacks and receipt transition ownership predicates; the async `getEventStatus` classification remains awaited.
- Added integration coverage for publication lease expiry and no republish after terminal receipt completion.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (integration suites skip cleanly without `TEST_REDIS_URL`/`TEST_DATABASE_URL`).
- `npm run build` — passed.

## Environment

- PostgreSQL and Redis integration tests were environment-gated and skipped because no disposable `TEST_DATABASE_URL`/`TEST_REDIS_URL` was configured. No external credentials were used.
