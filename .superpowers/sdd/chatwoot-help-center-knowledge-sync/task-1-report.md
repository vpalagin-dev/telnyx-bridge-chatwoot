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

## Fix round 1 (review findings)

Addressed the scoped review findings in `src/ai/chatwoot-knowledge.ts` and `tests/unit/ai/chatwoot-knowledge.test.ts`:

- Pagination now fails closed when neither a total-page field nor article/published count metadata is present.
- Empty payloads are rejected when counts claim articles exist, including `published_count > 0`; continuation pages with empty payloads remain invalid.
- Pagination count consistency is checked against the current payload and invalid/truncated responses are rejected.
- Article validation now rejects non-positive IDs, negative positions, blank slugs/titles, and empty/whitespace statuses.
- Unwrapped content retains its original leading/trailing whitespace; only recognized outer code fences are trimmed/removed. Whitespace-only content is still rejected.
- Added regression coverage for missing pagination metadata, inconsistent counts, malformed semantic fields, incomplete/truncated responses, and unwrapped whitespace preservation.

Fix-round verification:

- `npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts`: 5 passed.
- `npm run typecheck`: exited 0.
- TDD red evidence: the new regression tests initially failed 2 cases before production changes; after the fixes they passed.

## Fix round 2 (re-review findings)

Addressed the second review round in `src/ai/chatwoot-knowledge.ts` and `tests/unit/ai/chatwoot-knowledge.test.ts`:

- Removed unsafe completion inference from `publishedOnPage`; a draft-only first page now continues when aggregate raw counts require another page, and fails closed when continuation cannot be proven.
- Accumulate raw and published article counts across all fetched pages. When declared, `articles_count` and `published_count` must remain consistent across pages and exactly match the final aggregates.
- Reject declared totals larger than accumulated payload, mismatched empty single-page responses, and empty results without explicit `articles_count: 0` plus `published_count: 0` proof.
- Added coverage for draft-only first page followed by a published page, aggregate count underflow, conflicting empty single-page metadata, and explicitly proven empty datasets.

Fix-round 2 verification:

- `npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts`: 7 passed.
- `npm run typecheck`: exited 0.
- TDD red evidence: round 2 regression tests initially failed 2 cases before the production changes; after the fixes they passed.

## Fix round 3 (empty-result completeness)

- Empty payloads now require both explicit numeric `articles_count === 0` and `published_count === 0`; missing, nonzero, or conflicting counts fail closed, including metadata with only `current_page`/`total_pages` or only one zero count.
- Added regression cases for missing counts, `articles_count: 0` without `published_count`, nonzero/conflicting counts, and retained the valid explicitly proven empty dataset case.

Fix-round 3 verification:

- `npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts`: 7 passed.
- `npm run typecheck`: exited 0.
