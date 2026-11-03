# Task 2 Report: Persist Help Center Document Classification

## Files changed

- `src/persistence/schema.ts`
  - Added `category_slug` and `document_kind` columns with defaults.
  - Added the `system_prompt|factual` check constraint.
  - Added idempotent upgrade statements for existing databases.
- `src/persistence/postgres-knowledge-store.ts`
  - Added metadata to document INSERT parameters.
  - Selected metadata columns when loading active knowledge.
  - Mapped database metadata back to `KnowledgeDocument` unchanged.
- `tests/unit/persistence/postgres-knowledge-store.test.ts`
  - Extended schema, insert, and round-trip fake-query assertions.
- `tests/integration/persistence/postgres-knowledge-store.test.ts`
  - Added system-prompt/factual metadata round-trip assertions.

## Review-fix verification

Focused command:

```text
npx vitest run tests/unit/persistence/postgres-knowledge-store.test.ts tests/integration/persistence/postgres-knowledge-store.test.ts
```

Result:

- Unit test file: 1 passed; 4 tests passed.
- Integration test file: skipped because `TEST_DATABASE_URL` is not set; 3 tests skipped.
- Overall: 1 passed, 1 skipped test file; 4 passed, 3 skipped tests.
- The activation fake now captures and asserts every document INSERT parameter, including `categorySlug` and both `system_prompt` and `factual` kinds.

Typecheck command:

```text
npm run typecheck
```

Result: failed outside this scoped fix in `tests/unit/ai/knowledge-provider.test.ts` at lines 91 and 106 (`TS2554: Expected 1 arguments, but got 2`). No AI/provider files were changed for this review fix; the persistence unit and integration test command remains green/skipped as reported above.

## Decisions and concerns

- Preserved transaction and advisory-lock activation ordering; metadata is inserted before the prior active snapshot is superseded.
- Kept migrations idempotent. After `ADD COLUMN IF NOT EXISTS`, a migration DO block validates that both legacy columns are exactly `text NOT NULL` with the required defaults and raises a clear incompatibility error otherwise.
- The same-named kind constraint is now checked by its canonical PostgreSQL definition; a different definition fails closed instead of being accepted silently. Missing constraints are added as before.
- Existing rows still receive the factual default through the idempotent schema upgrade; fresh snapshots preserve Chatwoot classification metadata.
- Integration coverage remains opt-in and was explicitly skipped without `TEST_DATABASE_URL`.
- PostgreSQL integration round-trip remains a deployment-environment verification gap because no disposable database URL was available.
