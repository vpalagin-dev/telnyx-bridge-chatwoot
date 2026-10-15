# Task 1 Report: Chatwoot Help Center Article Client

## Status

Implemented and committed the Chatwoot Help Center article client, published filtering, pagination, and knowledge-document normalization.

## Files changed

- `src/ai/chatwoot-knowledge.ts`
  - Added the public Task 1 types and client factory.
  - Requests `GET /api/v1/accounts/{accountId}/portals/{portalSlug}/articles?locale={locale}&page={page}`.
  - Sends `api_access_token` and `Accept: application/json` headers.
  - Validates HTTP status, JSON shape, pagination metadata, and article fields.
  - Follows reported `total_pages`/compatible page-count metadata and derives a page count from published counts when explicit total pages are absent.
  - Filters to `status === "published"`.
  - Normalizes only outer Markdown/text code-fence wrappers and preserves article title, slug, punctuation, and factual content.
  - Rejects normalized empty content.

- `tests/unit/ai/chatwoot-knowledge.test.ts`
  - Added tests for production-shaped snake_case article payloads.
  - Covers published filtering, page 1/page 2 requests, URL construction, authentication/Accept headers, malformed/non-2xx responses, invalid articles, incomplete pages, code-fence normalization, punctuation preservation, and empty normalized content.

## TDD evidence

1. Wrote the focused tests before the production module existed.
2. Ran `npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts` and observed the expected missing-module failure.
3. Implemented the minimal client/normalizer boundary.
4. Re-ran focused tests: 4 passed.
5. Ran strict typecheck: passed.
6. Ran the full test suite: 133 passed, 28 skipped, 2 skipped test files.

## Verification outputs

- Focused: `Test Files 1 passed; Tests 4 passed`
- Typecheck: `tsc -p tsconfig.json --noEmit` exited 0
- Full suite: `Test Files 28 passed | 2 skipped; Tests 133 passed | 28 skipped`

## Decisions and concerns

- The client maps Chatwoot's observed `updated_at` response field to the public `updatedAt` type while retaining the public camelCase interface.
- The request uses the configured portal slug as required; it does not substitute a numeric portal ID.
- Pagination supports explicit `total_pages`, `pages`, and `page_count` metadata. If explicit total pages are absent, it uses published/article counts and the number of published articles on the current page as a conservative fallback. A page whose metadata claims continuation but has no payload is rejected.
- The normalizer intentionally does not summarize, rewrite, strip arbitrary HTML, or alter factual text. It removes only an outer code fence with optional `markdown`, `md`, or `text` language labels.
- Full-suite persistence tests that require external services remained skipped by the repository's existing test configuration; all runnable tests passed.
