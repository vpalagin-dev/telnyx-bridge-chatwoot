# Task 4 Report: Chatwoot Prompt and Bounded Retrieval

## Files changed

- `src/ai/knowledge.ts`
  - Added optional `systemPrompt` to `ApprovedKnowledge`.
- `src/ai/knowledge-provider.ts`
  - Added backward-compatible optional query parameter.
  - Returns the sole active Chatwoot `system_prompt` document separately.
  - Excludes system prompts from factual context.
  - Added deterministic Unicode lexical tokenization and title/slug-weighted scoring.
  - Added deterministic position/source-ID tie ordering, document-count and character-length caps.
  - Returns empty factual context when a supplied query has no lexical match.
  - Preserves local mode and local fallback without accessing the store in local mode.
- `tests/unit/ai/knowledge-provider.test.ts`
  - Covered prompt output/exclusion, ranking, no-match behavior, caps, missing prompt, local mode, and no-network behavior.

## Verification

- `npx vitest run tests/unit/ai/knowledge-provider.test.ts tests/unit/ai/knowledge.test.ts`
  - 2 files passed; 10 tests passed.
- `npm run typecheck`
  - Passed.

## Decisions

- Retrieval uses Unicode letter/number tokens with NFKC normalization and locale-independent lowercasing.
- Title and slug token matches receive higher weight than content matches.
- Omitted queries preserve the prior all-factual-document behavior, subject to the new safety caps; an explicitly supplied query with no tokens produces empty context.
- An active Chatwoot snapshot with zero or multiple system prompts fails closed with `chatwoot_knowledge_system_prompt_missing_or_ambiguous`.

## Scope note

The pre-existing pending change to `tests/unit/persistence/postgres-knowledge-store.test.ts` was left untouched and excluded from the Task 4 commit.
