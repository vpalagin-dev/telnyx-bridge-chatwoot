# Task 1 Report: Chatwoot Article Category Metadata

## Changes

- Added optional `categorySlug` metadata to `ChatwootKnowledgeArticle`.
- Added required `categorySlug` and `kind` fields to `KnowledgeDocument`.
- Added exported `parseArticlePayload` and category extraction with precedence:
  1. `category.slug`
  2. `category_slug`
  3. `category.name`
  4. `category_name`
- Category values are trimmed, lowercased, and have whitespace/underscores converted to hyphens; non-string and empty values are ignored.
- `normalizeKnowledgeArticle` normalizes direct article category values and classifies only exact `system-prompt` as `system_prompt`; all other articles are `factual`.
- Added parser, normalization, classification, and missing-category regression coverage.

## Verification

Focused test command:

```text
npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts

 RUN  v5.0.1 C:/work/telnyx

 ✓ tests/unit/ai/chatwoot-knowledge.test.ts (15 tests) 35ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  13:41:15
   Duration  226ms (tests 39%, transform 37%, import 17%, worker 6%)
```

The new direct-normalization regression was first run before the implementation fix and failed as expected (`expected 'system-prompt', received ' System_Prompt '`), then passed in the final focused run above.

Typecheck command:

```text
npm run typecheck

> telnyx-chatwoot-sms-bridge@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit

src/persistence/postgres-knowledge-store.ts(74,3): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
tests/integration/persistence/postgres-knowledge-store.test.ts(27,7): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
tests/integration/persistence/postgres-knowledge-store.test.ts(28,7): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
tests/unit/ai/knowledge-provider.test.ts(29,9): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
tests/unit/ai/knowledge-provider.test.ts(30,9): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
tests/unit/ai/knowledge-provider.test.ts(55,19): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
tests/unit/persistence/postgres-knowledge-store.test.ts(9,3): error TS2739: Type '{ sourceArticleId: number; slug: string; title: string; content: string; sourceUpdatedAt: string; position: number; }' is missing the following properties from type 'KnowledgeDocument': categorySlug, kind
[exit code: 1]
```

Typecheck is blocked by existing consumers and fixtures that construct `KnowledgeDocument` without the two newly required Task 1 fields. Those files are outside Task 1's approved file scope and were not modified.

## Scope

Only the approved Task 1 implementation and unit-test files, plus this Task 1 report, are included in the Task 1 commit. No later task work was started.
