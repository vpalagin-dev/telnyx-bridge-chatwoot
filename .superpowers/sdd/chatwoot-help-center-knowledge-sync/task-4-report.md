# Task 4 Report: Source-Neutral AI Knowledge Provider

## Status
Implemented and verified.

## Changes
- Added `KnowledgeProvider` and `createKnowledgeProvider` in `src/ai/knowledge-provider.ts`.
- Added local and Chatwoot source selection. Local mode invokes only the existing local loader. Chatwoot mode reads `KnowledgeStore.getActiveKnowledge(profileId)`, maps active documents into deterministic `ApprovedKnowledge.eventMarkdown`, and falls back to the local loader only when no active snapshot exists.
- Added `AI_KNOWLEDGE_SOURCE` (`local` default), `CHATWOOT_HELP_CENTER_SLUG` (`jama-help-center` default), `CHATWOOT_HELP_CENTER_LOCALE` (`en` default), and `AI_KNOWLEDGE_SYNC_INTERVAL_MS` (`300000` default). Chatwoot mode rejects a blank help-center slug.
- Added optional provider wiring to `processAiPostInbound`; existing local fixtures remain compatible, and existing decision/fallback/history/escalation/Telnyx flows are unchanged.
- Added config, provider, and AI integration tests. The provider integration test verifies approved context reaches the AI adapter.

## TDD Evidence
Focused tests were run red before implementation:
- Provider suite failed because the provider module did not exist.
- New config assertions failed because source settings were absent.
- AI provider integration failed because process-ai did not load the injected provider.

## Verification
- `npx vitest run tests/unit/config.test.ts tests/unit/ai/knowledge-provider.test.ts tests/unit/ai/knowledge.test.ts tests/integration/ai/conversation-policy.test.ts`: **27 passed**.
- `npm run typecheck`: **passed**.
- `npm test`: **163 passed, 31 skipped (34 files; 3 database-dependent suites skipped)**.

## Concerns
- Runtime construction currently exposes the provider injection boundary but does not instantiate a Chatwoot `KnowledgeStore` provider itself; the worker/runtime integration can supply the provider when the PostgreSQL knowledge store is wired.
- `BridgeConfig.ai` knowledge settings are optional at the type level to preserve existing hand-built test/runtime fixtures; `loadConfig` always supplies the configured defaults.
