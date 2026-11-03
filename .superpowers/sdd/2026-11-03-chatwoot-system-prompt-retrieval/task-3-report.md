# Task 3 Report: Require Exactly One System Prompt

## Scope

Implemented Task 3 only. `createKnowledgeSyncService` now validates the normalized published article set before hashing/activation and requires exactly one `kind === 'system_prompt'` document.

## Behavior

- Zero system-prompt documents and more than one system-prompt document both fail with the fixed code `chatwoot_knowledge_system_prompt_missing_or_ambiguous`.
- Validation runs before `activateChatwootSnapshot`, so invalid sets cannot activate.
- A valid set containing one system prompt and factual documents activates all documents; the prompt remains included in the snapshot article count and hash input.
- Existing sanitized error logging remains intact: error names/codes are logged without article content or raw error messages.

## Tests

Added focused coverage for:

- Missing system prompt and activation suppression.
- Ambiguous multiple system prompts and activation suppression.
- One system prompt plus two factual documents, including all kinds passed to activation.
- Sanitized validation error classification and no article-content leakage.
- Updated deterministic hash and empty-result fixtures for the new invariant.

Failing-first run observed the expected missing validation failures before implementation. Final command:

```text
npx vitest run tests/unit/ai/knowledge-sync.test.ts

Test Files  1 passed (1)
Tests       21 passed (21)
```

## Commit

`feat(knowledge): require a published system prompt article`

Task 4 was not started.
