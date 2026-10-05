# Task 4 Report: Receipt-First Webhook Routing

## Implemented

- Added an optional `receiptAdapter.insertReceipt` dependency to `buildApp`.
- In `postgres_redis` mode, the Telnyx route now:
  - fails closed with HTTP 401 before parsing or persistence when `config.telnyx.publicKey` is missing;
  - authenticates the original raw request body before any persistence;
  - validates only the generic durable-receipt envelope (`data.id`, non-empty `data.event_type`, and object `data.payload`), with optional provider metadata accepted without business constraints;
  - inserts every authenticated generic event through the receipt adapter (which owns transactional receipt/outbox insertion and deduplication), including unsupported event types, MMS, and wrong-direction events;
  - returns HTTP 200 `{ accepted: true, receiptId }` for both first delivery and duplicate delivery;
  - does not invoke Chatwoot, OpenAI, or Telnyx inline.
- `buildRuntime` creates and initializes `PostgresStore` only for `postgres_redis`, while retaining the existing SQLite/default synchronous path.
- Invalid signatures still return HTTP 401 and do not call the receipt adapter.

## Verification

- TDD red phase: `npm exec vitest -- run tests/integration/webhooks.test.ts` failed on the new receipt-first response assertion while the existing route still processed inline.
- Targeted green phase: `npm exec vitest -- run tests/integration/webhooks.test.ts` — 13 tests passed.
- Typecheck: `npm run typecheck` — passed.
- Full suite: `npm test` — 109 passed, 19 skipped across 22 files.

## Limitations

- Worker execution and downstream processing of durable receipts are intentionally not implemented in Task 4.
- PostgreSQL integration tests remain environment-gated and were skipped because no disposable `TEST_DATABASE_URL` was configured; no Railway credentials were used.
- The receipt adapter is responsible for the transactional receipt plus outbox write; the app/runtime integration does not duplicate that storage logic.
- **Explicit follow-up gap:** approved Task 2 schema currently stores raw webhook payloads as JSONB, and this repository has no payload-encryption key configuration or helper. Task 4 therefore does not claim payload encryption compliance; adding encrypted payload storage and key management requires a separate approved follow-up.
