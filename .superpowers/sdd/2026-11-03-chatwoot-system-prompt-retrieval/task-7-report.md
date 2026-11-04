# Task 7 report: conversational Chatwoot Ama replies

## Implemented

- Added a failing AI integration regression for `How was your day?`; before the change Chatwoot mode passed the hardcoded no-approved-factual-context marker to the model.
- Chatwoot small-talk greetings and casual prompts now omit that factual no-context marker, allowing the Chatwoot system prompt/persona to produce a natural model answer.
- Factual retrieval remains unchanged and is covered with `When is the next event?`, asserting that the retrieved `## Event Details` article context is passed through as approved context.
- Added an integration case using the real Chatwoot knowledge provider with separate `system-prompt` and `event-details` categories: `How was your day?` receives no factual context, while `When is the next event?` retrieves only the Event Details article.
- Preserved `AI_SAFE_FALLBACK_TEXT` behavior for provider errors, invalid model responses, and missing system prompts; factual no-context requests still receive the explicit guard marker.

## Verification

- RED: `pnpm exec vitest run tests/integration/ai/conversation-policy.test.ts` — expected failure in the new small-talk test before implementation.
- Focused AI tests: `pnpm test:ai` — **15 files passed, 83 tests passed, 1 skipped**.
- Typecheck: `pnpm typecheck` — **passed**.
- Full suite: `pnpm test` — **37 files passed, 3 skipped; 210 tests passed, 31 skipped (241 total)**.

No Railway, production, or live provider settings were changed.
