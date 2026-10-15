# Task 2 Report: Durable PostgreSQL Knowledge Snapshots

## Status

Implemented and committed the PostgreSQL persistence boundary for versioned Chatwoot Help Center knowledge snapshots.

## Changes

- Added `KnowledgeStore`, `KnowledgeSnapshot`, and `ActiveKnowledge` interfaces/types.
- Added `PostgresKnowledgeStore` with:
  - upgrade-safe initialization through the shared schema SQL;
  - transactional snapshot activation;
  - per-profile advisory transaction locking;
  - complete document insertion before deactivating the previous active snapshot;
  - rollback on any insertion/activation failure;
  - active snapshot reads with documents ordered by `position` and `source_article_id`.
- Extended `telnyx_bridge` schema with `knowledge_snapshots` and `knowledge_documents`.
- Added source/status checks, article-count validation, foreign key/primary key constraints, active-profile indexes, and a PostgreSQL partial unique index enforcing one active snapshot per profile.
- Added unit SQL/transaction contract tests and environment-gated PostgreSQL integration tests.
- No raw Chatwoot API payloads are persisted.

## Verification

- `npx vitest run tests/unit/persistence/postgres-knowledge-store.test.ts tests/integration/persistence/postgres-knowledge-store.test.ts`
  - Unit: 4 passed.
  - Integration: 3 skipped because `TEST_DATABASE_URL` was not configured in this environment.
- `npm run typecheck`
  - Passed with exit code 0.

## Commit

The Task 2 changes are committed as:

- `feat(persistence): store versioned knowledge snapshots`

## Concerns

- A live PostgreSQL integration run still requires a disposable PostgreSQL instance exposed through `TEST_DATABASE_URL`; it was intentionally skipped according to repository conventions when unavailable.
- Existing deployments that already have a conflicting/invalid knowledge table definition would need a reviewed migration beyond the current `CREATE TABLE IF NOT EXISTS` upgrade-safe initialization pattern.
