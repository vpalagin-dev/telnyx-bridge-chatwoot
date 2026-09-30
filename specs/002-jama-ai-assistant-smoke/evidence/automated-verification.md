# Feature 002 automated verification

## Fake checkpoint

- Command: `npx vitest run tests/integration/ai/fake-smoke.test.ts tests/contract/marker-aware-webhook.test.ts`
- Result: 2 files, 4 tests passed.
- The fake fan-out asserts one approved-context decision, one same-conversation marked history record, one direct fake Telnyx submission, replay deduplication, and zero Telnyx submission for escalation.

## Regression verification

- `npm run typecheck`: passed.
- `npm test`: 14 files, 77 tests passed.
- `npm run test:ai`: 2 files, 4 tests passed in the current repository (focused AI test files not yet present in the baseline).
- No live provider test was run; the live-AI test uses an injected fetcher only unless the protected opt-in environment is explicitly supplied.

## Safety notes

- `OUTBOUND_MODE=fake` remains the default.
- Live AI SMS additionally requires `OUTBOUND_MODE=live`, `AI_LIVE_SMS_APPROVED=true`, an exact configured recipient allowlist match, a durable action claim, and the existing suppression/state checks.
- AI history uses `custom_attributes.ai_generated=true`; marked Chatwoot events are ignored before human recipient lookup and malformed markers fail closed.
- AI records contain identifiers/status/outcome/state only; transient customer text and model output are not stored.
- The dependency installation environment rejected the network fetch for `yaml@2.8.1`; the checked-in loader uses a confined exact-frontmatter parser and should be switched to the package parser when dependency installation is available.
