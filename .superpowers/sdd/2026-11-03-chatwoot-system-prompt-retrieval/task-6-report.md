# Task 6 report: configurable Chatwoot system-prompt category

## Implemented

- Added `CHATWOOT_SYSTEM_PROMPT_CATEGORY_SLUG`, defaulting to `system-prompt`, to environment parsing and `BridgeConfig.ai`.
- Passed the configured slug through runtime into Chatwoot knowledge synchronization.
- Classification normalizes the configured slug and marks exactly one matching published article as `system_prompt`; all other categories remain factual.
- Preserved local mode and the local bootstrap prompt at `specs/002-jama-ai-assistant-smoke/knowledge/ama-persona.md`.
- Updated `.env.example` and README with the Chatwoot contract: one published prompt article, factual categories, immutable snapshot behavior, bounded retrieval/no-result fallback, code-owned guard, no OpenAI tool calling, and local bootstrap retention.
- Added config, runtime, normalization, and sync-focused test coverage.

## Verification

- Focused tests: `npm exec vitest run tests/unit/config.test.ts tests/unit/runtime.test.ts tests/unit/ai/chatwoot-knowledge.test.ts tests/unit/ai/knowledge-sync.test.ts` — **4 files passed, 59 tests passed**.
- `npm run typecheck` — **passed**.
- `npm test` — **37 files passed, 3 skipped; 208 tests passed, 31 skipped (239 total)**.
- `npm run build` — **passed**.

No live Chatwoot, OpenAI, Telnyx, production, or destructive operation was performed. `ama-persona.md` was not removed.
