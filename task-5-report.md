# Task 5 Report: Durable AI terminal outcomes

## Implemented

- Successful AI replies now persist `outcome=answered`, `status=completed`, `state=ai_active`, Chatwoot history ID, and Telnyx action/message IDs through the PostgreSQL operational store.
- PostgreSQL AI outcome and conversation-state projections are transactional. Unknown paths persist explicit `outcome=unknown_needs_review`, `status=unknown_needs_review`, and `state=waiting_for_human` with a durable reason.
- Late history/submission/outcome writes preserve an existing unknown-review terminal state; they may retain provider IDs without downgrading review.
- Post-history rate-limit/suppression rejection and rate-limit exceptions terminalize the AI decision as review-required instead of leaving a claimed decision dangling.
- Inbound processing still completes the durable inbound receipt and returns its successful result, while exposing structured `aiResult`/`aiError` metadata rather than silently swallowing callback failures.
- No SQLite runtime path was introduced; PostgreSQL remains authoritative.

## TDD evidence

- Added focused `tests/integration/ai/task5-outcomes.test.ts` coverage for answered persistence, unknown waiting-for-human projection, and late-success protection.
- The focused tests were first run red (3 failures: provider_error persisted for answered, unknown state remained ai_active, and late success downgraded review), then passed after the minimal production changes.

## Verification

- `npm exec vitest -- run tests/integration/ai/task5-outcomes.test.ts tests/integration/ai/fake-smoke.test.ts` — 5 passed.
- Full `npm test` — 124 passed, 28 environment-gated skips.
- `npm run typecheck` — passed.
- `npm run build` — passed.

## Remaining concerns

- PostgreSQL integration suites remain environment-gated when `TEST_DATABASE_URL` is unavailable; the SQL paths are covered by the operational-store contract and focused fake-store tests.
- If persistence itself is unavailable while recording a review outcome, the caller still surfaces that failure for receipt-level recovery rather than falsely claiming a durable terminal projection.
