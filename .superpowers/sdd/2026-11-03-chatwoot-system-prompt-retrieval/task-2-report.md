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

## Verification

Command:

```text
npx vitest run tests/unit/persistence/postgres-knowledge-store.test.ts tests/integration/persistence/postgres-knowledge-store.test.ts
```

Output summary:

- Unit test file: 1 passed; 4 tests passed.
- Integration test file: skipped because `TEST_DATABASE_URL` is not set; 3 tests skipped.
- Overall: 1 passed, 1 skipped test file; 4 passed, 3 skipped tests.

Command:

```text
npm run typecheck
```

Result: fails in pre-existing `tests/unit/ai/knowledge-provider.test.ts` fixtures because three `KnowledgeDocument` literals do not yet include the required `categorySlug` and `kind` properties (TS2739 at lines 29, 30, and 55). No Task 2 persistence files are implicated by the compiler errors.

## Decisions and concerns

- Preserved transaction and advisory-lock activation ordering; metadata is inserted before the prior active snapshot is superseded.
- Existing rows receive the factual default through the idempotent schema upgrade; fresh snapshots preserve Chatwoot classification metadata.
- Integration coverage remains opt-in and was explicitly skipped without `TEST_DATABASE_URL`.
- The repository-wide typecheck remains blocked by the unrelated knowledge-provider test fixtures noted above; those fixtures were not changed to keep this commit scoped to Task 2.
