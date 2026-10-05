# Task 5 Report: Railway worker

## Implemented

- Added `processReceipt` adapter that accepts only `message.received` inbound SMS payloads and invokes the existing `processTelnyxInbound` pipeline once.
- Preserved the existing AI hook through the shared runtime pipeline. `BridgeStore` is used only for the existing inbound/AI operational state and is opened from configured `DATABASE_PATH`; receipt lifecycle remains authoritative in `PostgresStore`.
- Added explicit retry classification with bounded exponential backoff. Ambiguous inbound side effects and exhausted retries become `needs_review`; duplicate claims are no-ops.
- Added worker lifecycle with stable worker identity, PostgreSQL receipt ownership, Redis job consumption, PostgreSQL outbox job-to-receipt mapping, outbox recovery, and graceful shutdown.
- Added `src/worker.ts`, `start:web`, and `start:worker` role scripts.

## Verification

- `npm exec vitest -- run tests/integration/worker.test.ts` — passing (7 tests).
- `npm test` — passing (118 passed, 19 environment-gated skips).
- `npm run typecheck` — passing.
- `npm run build` — passing.

The worker integration test uses fakes and does not require Railway credentials. PostgreSQL/Redis end-to-end execution remains controlled by `TEST_DATABASE_URL`/`TEST_REDIS_URL` in the persistence suites.

## Operational note

In postgres/redis mode, deploy web and worker with the same persistent `DATABASE_PATH` volume (or provide the future PostgreSQL operational adapter) so the existing BridgeStore idempotency, AI decisions, suppression, and human/campaign behavior remain durable. The worker does not claim those tables are PostgreSQL-native.
