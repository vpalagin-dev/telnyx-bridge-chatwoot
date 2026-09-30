# Tasks: JAMA AI Assistant Smoke

**Input:** `specs/002-jama-ai-assistant-smoke/spec.md` and `specs/002-jama-ai-assistant-smoke/plan.md`

**Prerequisites:** Feature 001's inbound path and fake-provider baseline are available in this repository. Feature 002 may modify Feature 001 only at the narrow seams explicitly listed in `specs/002-jama-ai-assistant-smoke/plan.md`.

**TDD rule:** Every implementation task below writes its failing tests first, records a targeted RED run, implements the smallest behavior that satisfies those tests, records a targeted GREEN run, and ends with a verification checkpoint. No implementation is authorized without its preceding RED evidence.

## Scope, architecture, and non-negotiable safety rules

- Feature 001 owns Telnyx inbound authentication/normalization/suppression, contact/conversation mapping, and creation of the inbound Chatwoot message.
- Feature 002 runs synchronously only after Feature 001 has successfully created and correlated that inbound Chatwoot message.
- Feature 002 creates one bridge-owned AI history record in the same Chatwoot conversation with `ai_generated: true` only after response validation and the marker hard gate; if metadata is not preserved, the only accepted equivalent is the durable Chatwoot history-message-ID lookup defined below.
- Feature 002 dispatches the same validated text directly through the AI Telnyx adapter. It never re-enters or depends on the human `Chatwoot webhook -> processChatwootOutbound -> Telnyx` path.
- `AI_ENABLED=false` is the default and must make zero OpenAI calls and zero AI-created Chatwoot messages.
- `AI_ENABLED=true` alone must select fake/no-network OpenAI behavior; a real OpenAI adapter requires `AI_PROVIDER_MODE=live`, `AI_LIVE_OPENAI_ENABLED=true`, and an externally supplied `OPENAI_API_KEY`.
- `OUTBOUND_MODE=fake` is the default and is mandatory for fake smoke and local live-AI tests; these modes must make zero Telnyx network calls.
- `OUTBOUND_MODE=live` without explicit `AI_LIVE_SMS_APPROVED=true` fails closed. Live dispatch also requires an exact authoritative-recipient match in `AI_LIVE_RECIPIENT_ALLOWLIST`.
- OpenAI failure, invalid output, missing/ambiguous knowledge, Chatwoot history failure/ambiguity, suppression, `waiting_for_human`, `human_active`, or any failed safety gate makes zero Telnyx submissions.
- One stable inbound identity may create at most one AI decision, one AI Chatwoot history record, and one Telnyx submission. Ambiguous side effects become `unknown_needs_review`; they are never blind-retried.
- `AI_DEFAULT_EVENT_ID` is the only initial event selector. Do not infer event identity from SMS text, conversation metadata, fuzzy matching, embeddings, or model output.
- Durable AI records and logs must not contain API keys, full phone numbers, SMS bodies, raw prompts/context, raw OpenAI responses, or provider authorization headers.
- Do not modify `C:\work\germes`, create another Chatwoot deployment, add secrets, add a public arbitrary-recipient endpoint, or add campaigns/scheduling/proactive AI.

## Binding current-baseline and exception decisions

The current repository implementation is Fastify, Node.js built-in SQLite through synchronous `BridgeStore`, and synchronous webhook processing. It has no PostgreSQL, worker, queue, lease system, or readiness artifact. Feature 002 targets this interim baseline only. It MUST NOT introduce PostgreSQL, workers, queues, leases, or a migration from Feature 001's future target plan, and it MUST NOT claim to satisfy that unimplemented architecture. Existing Feature 001 plaintext storage remains unchanged in this interim track; full Feature 001 privacy/encryption is separate.

Feature 002 is a separately scoped and versioned exception to Feature 001's AI/automation outbound prohibition. It permits only one AI response synchronously triggered by one eligible inbound Telnyx SMS through the separate Feature 002 dispatcher. It does not weaken Feature 001 human outbound authorization, suppression, recipient binding, deduplication, or restrictions against campaigns, scheduling, proactive sends, broadcasts, or arbitrary recipients.

The canonical live OpenAI predicate is `AI_ENABLED=true AND AI_PROVIDER_MODE=live AND AI_LIVE_OPENAI_ENABLED=true AND OPENAI_API_KEY is present`; otherwise fake/no-network behavior or fail-closed behavior is required. The canonical live SMS predicate is `OUTBOUND_MODE=live AND AI_LIVE_SMS_APPROVED=true AND authoritative conversation-bound recipient is in AI_LIVE_RECIPIENT_ALLOWLIST AND durable AI live guard is available AND suppression/state/encoding/readiness/deduplication checks pass`.

Fake-only interim smoke is implementable after these documentation gates. Local live-AI means real OpenAI + local Chatwoot + fake Telnyx. End-to-end live AI SMS remains blocked until all live gates pass.

## Task groups and dependency graph

| Group | Tasks | Depends on | Gate produced |
|---|---:|---|---|
| Reconciliation and safety contracts | T000-T000J | Current repository inspection | Baseline, exception, marker, outcome, callback, SQLite, encoding, secret, interface, and zero-network gates |
| Foundation and configuration | T001-T003 | T000-T000J | Validated AI config, safe knowledge fixture layout, provider contracts |
| Knowledge and policy | T004-T005 | T001-T003 | Deterministic approved context, validated response/escalation policy |
| Provider and history boundaries | T006-T007 | T001-T003 | Fake/live OpenAI, safe Chatwoot history, marker contract |
| Durable state and dispatch | T008-T009 | T001, T005-T007 | Atomic state/dedupe, fake/live direct AI Telnyx gates |
| Orchestration and Feature 001 seams | T010-T012 | T004-T009 | Post-inbound fan-out, marker-aware human path, unchanged inbound behavior |
| Smoke, live-AI, and final verification | T013-T015 | T010-T012 | Fake smoke, opt-in local live-AI, privacy/regression completion evidence |

Tasks within a group marked `[P]` may be worked in parallel only when their listed dependencies and RED evidence already exist. Tasks that share a file or a state-machine contract remain sequential.

---

## Group 0 — Reconciliation and safety contracts

### T000 Reconcile the current repository baseline

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/spec.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md`
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/feature-002-baseline.test.ts`

- [ ] **Step 1 — RED:** Test that the selected baseline is Fastify + synchronous SQLite `BridgeStore`, with no PostgreSQL, worker, queue, lease, or readiness artifact, and that Feature 002 does not add those systems.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/feature-002-baseline.test.ts`; expected failure until the baseline contract is represented.
- [ ] **Step 3 — Reconcile:** Record interim smoke-only scope and explicitly reject accidental PostgreSQL/worker migration.
- [ ] **Step 4 — GREEN command:** Run the baseline test and `npm run typecheck` without provider calls.

### T000A Formalize the cross-feature exception

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/spec.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md`
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/feature-002-exception.test.ts`

- [ ] **Step 1 — RED:** Assert that only one inbound-triggered AI response is allowed through a separate dispatcher and that human authorization plus campaign/scheduler/proactive/broadcast/arbitrary-recipient restrictions remain unchanged.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/feature-002-exception.test.ts`; expected failure before the exception contract is encoded.
- [ ] **Step 3 — Reconcile:** Treat Feature 002 as a versioned exception, not a rewrite of Feature 001.
- [ ] **Step 4 — GREEN command:** Run the exception test and existing human outbound tests.

### T000B Make marker validation a hard gate

**Files:**
- Modify: `src/chatwoot/client.ts`
- Modify: `src/chatwoot/http-client.ts`
- Create: `tests/contract/chatwoot-ai-marker-gate.test.ts`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/chatwoot-ai-history-validation.md`

- [ ] **Step 1 — RED:** Test that AI history creation and direct AI live dispatch are disabled until marker preservation is validated or the concrete durable history-message-ID lookup fallback is implemented.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/chatwoot-ai-marker-gate.test.ts`; expected failure before the gate exists.
- [ ] **Step 3 — Implement:** Use a separate `ChatwootAiHistoryWriter`; if Chatwoot drops metadata, record the history message ID in the AI decision and make the human path consult it, failing closed on unknown/unavailable lookup.
- [ ] **Step 4 — GREEN command:** Run the gate test with no local Chatwoot, OpenAI, or Telnyx call.

### T000C Add tri-state marker filtering

**Files:**
- Modify: `src/outbound/process-outbound.ts`
- Create: `tests/contract/marker-aware-webhook.test.ts`

- [ ] **Step 1 — RED:** Cover absent marker, valid `ai_generated=true`, marker in body only, and present-but-malformed marker.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/marker-aware-webhook.test.ts`; expected failure for marker cases.
- [ ] **Step 3 — Implement:** Absent marker follows normal human eligibility; valid marker is ignored before lookup/claim/send; malformed marker fails closed/review with zero Telnyx and no human fallback.
- [ ] **Step 4 — GREEN command:** Run the marker contract and existing outbound/webhook tests.

### T000D Define the fallback/outcome matrix

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/spec.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md`
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/ai-outcome-matrix.test.ts`

- [ ] **Step 1 — RED:** Assert supported validated answer → at most one history and one submission; fallback/escalation/provider/validation/missing-knowledge/suppressed/human/blocked/ambiguous-history → zero Telnyx submissions.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/ai-outcome-matrix.test.ts`; expected failure until orchestration policy exists.
- [ ] **Step 3 — Reconcile:** Keep “at most one” as an upper bound and prohibit raw/fabricated model output.
- [ ] **Step 4 — GREEN command:** Run the matrix with fake adapters only.

### T000E Isolate post-inbound callback failures

**Files:**
- Modify: `src/inbound/process-inbound.ts`
- Modify: `src/app.ts`
- Modify: `src/runtime.ts`
- Create: `tests/integration/ai/post-inbound-isolation.test.ts`

- [ ] **Step 1 — RED:** Test that a completed inbound remains completed and does not become HTTP 503 when the AI callback fails or times out, and that duplicate delivery cannot create a second AI decision.
- [ ] **Step 2 — RED command:** `npx vitest run tests/integration/ai/post-inbound-isolation.test.ts`; expected failure before isolation exists.
- [ ] **Step 3 — Implement:** Invoke AI only after successful inbound creation/correlation, store AI outcome separately, and preserve the completed inbound acknowledgement.
- [ ] **Step 4 — GREEN command:** Run the isolation test and existing inbound/webhook tests.

### T000F Prove SQLite atomicity and concurrency

**Files:**
- Modify: `src/db/store.ts`
- Create: `tests/integration/ai/sqlite-concurrency.test.ts`

- [ ] **Step 1 — RED:** Test atomic concurrent claims, one inbound identity, one history ID, one AI action ID, restart durability, sticky states, and no reclaim of unknown/ambiguous decisions.
- [ ] **Step 2 — RED command:** `npx vitest run tests/integration/ai/sqlite-concurrency.test.ts`; expected failure because AI tables/methods are absent.
- [ ] **Step 3 — Implement:** Use SQLite transactions/conditional uniqueness within `DatabaseSync`; do not claim PostgreSQL or cross-store lock guarantees.
- [ ] **Step 4 — GREEN command:** Reopen a file-backed SQLite database and rerun the concurrency assertions.

### T000G Add SMS encoding validation

**Files:**
- Create: `src/ai/sms-validation.ts`
- Create: `tests/unit/ai/sms-validation.test.ts`

- [ ] **Step 1 — RED:** Test GSM-7 boundaries, extension characters, UCS-2/non-GSM text, empty text, and single-segment rejection.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/ai/sms-validation.test.ts`; expected failure because the validator is absent.
- [ ] **Step 3 — Implement:** Validate the final supported answer before history/Telnyx side effects.
- [ ] **Step 4 — GREEN command:** Run the validator tests and typecheck.

### T000H Protect live-AI secret injection

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/live-ai-gates.test.ts`

- [ ] **Step 1 — RED:** Assert incomplete live gates skip/fail closed and no command embeds `OPENAI_API_KEY` inline or writes it to evidence.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/live-ai-gates.test.ts`; expected failure until protected injection is documented.
- [ ] **Step 3 — Reconcile:** Require protected environment/secret-manager injection; prohibit shell history, logs, and evidence capture.
- [ ] **Step 4 — GREEN command:** Run without a key and without network access.

### T000I Preserve interface compatibility

**Files:**
- Modify: `src/chatwoot/client.ts`
- Modify: `src/config/env.ts`
- Modify: `tests/unit/runtime.test.ts`
- Modify: `tests/integration/webhooks.test.ts`
- Create: `tests/contract/feature-002-interfaces.test.ts`

- [ ] **Step 1 — RED:** Prove current `ChatwootClient` fakes remain valid through separate `ChatwootAiHistoryWriter`, and all typed `BridgeConfig` fixtures include AI fields without changing human outbound defaults.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/feature-002-interfaces.test.ts tests/unit/runtime.test.ts tests/integration/webhooks.test.ts`; expected type/contract failures before compatibility updates.
- [ ] **Step 3 — Implement:** Compose AI history separately and update every existing config fixture explicitly.
- [ ] **Step 4 — GREEN command:** Run interface tests and typecheck.

### T000J Prove exact zero-network behavior

**Files:**
- Create: `tests/contract/feature-002-zero-network.test.ts`
- Create: `tests/integration/ai/fake-provider-isolation.test.ts`

- [ ] **Step 1 — RED:** Assert fake smoke constructs no live OpenAI/Telnyx provider path, makes no HTTP Chatwoot call, and makes zero network calls for every failure/escalation/blocked case.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/feature-002-zero-network.test.ts tests/integration/ai/fake-provider-isolation.test.ts`; expected failure until composition/fakes exist.
- [ ] **Step 3 — Implement:** Inject fake providers and make live clients unreachable from fake smoke.
- [ ] **Step 4 — GREEN command:** Run with network-capable clients composed but no network invocation.

---

## Group 1 — Foundation and configuration

### T001 [P] Add Feature 002 configuration and safe fixture layout

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.ts`
- Modify: `tests/unit/config.test.ts`
- Create: `tests/unit/ai/config.test.ts`
- Create: `specs/002-jama-ai-assistant-smoke/knowledge/events/event-afrorave-river.md`
- Create: `specs/002-jama-ai-assistant-smoke/knowledge/events/event-jama-juls.md`
- Create: `specs/002-jama-ai-assistant-smoke/knowledge/shared/jama-support.md`

**Interfaces produced:** `loadConfig(environment)` returns normalized `BridgeConfig.ai` and `BridgeConfig.aiOutbound`; `AI_PROVIDER_MODE` is `fake|live`, default `fake`; allowlist parsing returns validated E.164 values without logging them.

- [ ] **Step 1 — Write failing tests first:** Add tests for `AI_ENABLED=false`, provider `fake`, model `gpt-4o-mini`, bounded defaults (`OPENAI_MAX_INPUT_TOKENS=2048`, `OPENAI_MAX_OUTPUT_TOKENS=256`, `OPENAI_TIMEOUT_MS=5000`), fallback text, escalation enabled, live approval false, fake mode without an OpenAI key, live mode requiring both live flags and a key, invalid bounds, missing `AI_DEFAULT_EVENT_ID`, repository-confined `AI_KNOWLEDGE_ROOT`, allowlist parsing, and fake/local-live requirement for `OUTBOUND_MODE=fake`. Add regression assertions that Feature 001 outbound defaults remain unchanged.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/ai/config.test.ts tests/unit/config.test.ts`
  - Expected result: FAIL because `BridgeConfig.ai`, `BridgeConfig.aiOutbound`, new environment validation, and fixture files do not yet exist.
- [ ] **Step 3 — Minimal implementation:** Extend `src/config/env.ts` with the Feature 002 variables and closed validation, including canonical `AI_PROVIDER_MODE` gating. Update every existing typed `BridgeConfig` fixture, including `tests/unit/runtime.test.ts` and `tests/integration/webhooks.test.ts`, without changing human outbound defaults. Add exact scripts `test:ai` and `test:live-ai` to `package.json`; add `yaml@2.8.1` only if the repository does not already provide it. Create only demo/test Markdown fixtures, visibly marked `demo/test data — not real JAMA facts`, with no secrets or customer data.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/unit/ai/config.test.ts tests/unit/config.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Confirm `AI_ENABLED=true` with live OpenAI disabled does not require `OPENAI_API_KEY`, `AI_ENABLED=false` makes no provider requirement, `OUTBOUND_MODE` still defaults to `fake`, and `git diff --check` plus `npm test` pass. No provider is called.

### T002 [P] Define shared AI types and fake OpenAI contract

**Files:**
- Create: `src/ai/types.ts`
- Create: `src/ai/openai-fake.ts`
- Create: `tests/contract/ai-openai-adapter.test.ts`

**Interfaces produced:** `OpenAiAdapter.generate(request: OpenAiRequest): Promise<OpenAiDecision>`; `FakeOpenAiAdapter` accepts a scripted decision/function and captures only safe request metadata (`model`, limits, event ID).

- [ ] **Step 1 — Write failing tests first:** Add contract tests for deterministic fake answer, fallback, provider error, request metadata capture, no raw prompt/response persistence, and a provider-selection assertion that `AI_ENABLED=true` with live OpenAI disabled does not construct or call a live adapter.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/ai-openai-adapter.test.ts`
  - Expected result: FAIL with missing `src/ai/types.ts` and `src/ai/openai-fake.ts` exports.
- [ ] **Step 3 — Minimal implementation:** Define the shared request/decision/provider types from `plan.md` and implement the fake adapter with deterministic scripted output and safe capture only. Do not import a network client.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/contract/ai-openai-adapter.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Prove the fake adapter makes zero `fetch` calls, never stores raw content, and is usable by later orchestration tests.

### T003 [P] Establish fake-provider fixtures and test-only adapter composition

**Files:**
- Create: `tests/fixtures/ai/inbound-question.json`
- Create: `tests/fixtures/ai/chatwoot-ai-history.json`
- Create: `tests/fixtures/ai/fake-smoke-config.ts` if shared setup is needed
- Modify: `src/runtime.ts`
- Modify: `tests/unit/runtime.test.ts`

- [ ] **Step 1 — Write failing tests first:** Test that fake mode composes fake OpenAI, fake Chatwoot, and fake AI Telnyx dependencies without constructing live HTTP clients for provider calls; live OpenAI composition is unavailable unless all explicit live flags are true.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/runtime.test.ts`
  - Expected result: FAIL because Feature 002 provider composition and fixtures are absent.
- [ ] **Step 3 — Minimal implementation:** Add dependency-injection seams in runtime without changing Feature 001's existing client defaults. Keep all fixture IDs synthetic and redacted.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/unit/runtime.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Inspect the composition path to prove fake mode cannot instantiate a network-capable OpenAI/Telnyx path for a test run; do not call either provider.

---

## Group 2 — Knowledge and policy

### T004 [P] Implement approved Markdown/YAML knowledge loading and deterministic event selection

**Files:**
- Create: `src/ai/knowledge.ts`
- Create: `src/ai/event-selection.ts`
- Create: `tests/unit/ai/knowledge.test.ts`
- Create: `tests/unit/ai/event-selection.test.ts`
- Create: `tests/fixtures/ai/knowledge/events/expired.md`
- Create: `tests/fixtures/ai/knowledge/events/draft.md`
- Create: `tests/fixtures/ai/knowledge/events/duplicate-event-id.md`

**Interfaces produced:** `loadApprovedKnowledge(root, eventId, now): Promise<ApprovedKnowledge>`; `selectDefaultEvent(eventId, loader, now): Promise<EventSelection>`.

- [ ] **Step 1 — Write failing tests first:** Cover exactly the four event frontmatter keys (`event_id`, `status`, `effective_from`, `review_by`), unique exact matching, `status: approved`, date boundaries, visible demo notice, root traversal rejection, malformed YAML, duplicate IDs, missing ID, body-only ID, expired/future/draft documents, and no event-selection callback based on inbound text or an LLM.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/ai/knowledge.test.ts tests/unit/ai/event-selection.test.ts`
  - Expected result: FAIL because loader/selector modules are absent.
- [ ] **Step 3 — Minimal implementation:** Parse YAML frontmatter with `yaml`, reject unknown/missing required keys, confine resolved files under `AI_KNOWLEDGE_ROOT`, require current approved documents, load only the selected event plus `shared/jama-support.md`, and never inspect conversation metadata or SMS text for selection.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/unit/ai/knowledge.test.ts tests/unit/ai/event-selection.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Assert selected context contains no unrelated event content, fixtures contain no secrets/private data, and `npm test` remains green.

### T005 [P] Implement response validation, escalation, and AI state policy

**Files:**
- Create: `src/ai/response-validation.ts`
- Create: `src/ai/escalation.ts`
- Create: `tests/unit/ai/response-validation.test.ts`
- Create: `tests/unit/ai/escalation.test.ts`

**Interfaces produced:** `validateAiDecision(decision, policy): ValidatedAiDecision`; `classifyEscalation(customerMessage): EscalationCategory | null`; `transitionForOutcome(outcome): { state, outcome }`.

- [ ] **Step 1 — Write failing tests first:** Cover supported answer, empty/malformed/over-limit output, unsupported claims, prompt injection, fallback, refunds/payments, complaints, safety/emergency/harassment/threats, VIP/artist access, partnership/sponsorship, press/media, unsupported/account-specific requests, provider error, and sticky `human_active` behavior.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/ai/response-validation.test.ts tests/unit/ai/escalation.test.ts`
  - Expected result: FAIL because policy modules are absent.
- [ ] **Step 3 — Minimal implementation:** Enforce trimmed bounded SMS-safe output, reject model-controlled routing/event fields, normalize safe fallback/error outcomes, classify mandatory escalation categories deterministically, transition escalation/fallback to `waiting_for_human`, keep accepted supported answers in `ai_active`, and make `human_active` sticky.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/unit/ai/response-validation.test.ts tests/unit/ai/escalation.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Assert returned errors/log metadata contain categories and IDs only, never model text; run `npm test`.

---

## Group 3 — Provider and Chatwoot history boundaries

### T006 Implement the live OpenAI adapter with bounded, secret-safe behavior

**Files:**
- Create: `src/ai/openai-live.ts`
- Modify: `tests/contract/ai-openai-adapter.test.ts`
- Create: `tests/unit/ai/openai-live.test.ts`

**Interfaces produced:** `LiveOpenAiAdapter({ apiKey, model, timeoutMs, fetcher? })` implements `OpenAiAdapter`.

- [ ] **Step 1 — Write failing tests first:** Add tests for one request only, fixed system instruction, selected event/context and bounded limits, bearer header, timeout abort, HTTP/rate-limit failure, malformed response, secret-safe errors, and no raw provider body in logs/errors.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/ai-openai-adapter.test.ts tests/unit/ai/openai-live.test.ts`
  - Expected result: FAIL because the live adapter is absent.
- [ ] **Step 3 — Minimal implementation:** Use native `fetch` with `AbortSignal.timeout(timeoutMs)` to POST the bounded request to OpenAI, normalize only `answer`, `fallback`, or typed provider errors, perform input preflight, make no retries, and never expose the API key or raw provider body.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/contract/ai-openai-adapter.test.ts tests/unit/ai/openai-live.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Run the tests with no `OPENAI_API_KEY`; all live adapter network tests use injected fetchers only. Do not call OpenAI.

### T007 Add the explicit Chatwoot AI history operation and complete CHW-002-01 validation

**Files:**
- Modify: `src/chatwoot/client.ts`
- Modify: `src/chatwoot/http-client.ts`
- Create: `tests/contract/chatwoot-ai-history.test.ts`
- Modify: `tests/unit/clients.test.ts`
- Create: `tests/fixtures/ai/chatwoot-ai-history.json`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/chatwoot-ai-history-validation.md`

**Interfaces produced:** `createAiHistoryMessage(conversationId, text, metadata): Promise<{ id: number }>` implements `ChatwootAiHistoryWriter`.

- [ ] **Step 1 — Write failing tests first:** Test same-conversation creation, bridge-owned `ai_generated=true`, decision/event metadata, marker-safe response parsing, no Telnyx invocation, no human webhook dependency, secret-safe handling, no raw response persistence, and unchanged `createIncomingMessage` payload.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/chatwoot-ai-history.test.ts tests/unit/clients.test.ts`
  - Expected result: FAIL because the AI history method and contract are absent.
- [ ] **Step 3 — Minimal implementation:** Add a separate `ChatwootAiHistoryWriter` operation. During implementation, perform CHW-002-01 only with separately authorized local Chatwoot validation; capture only redacted message/webhook evidence, and make marker preservation a hard gate before AI history creation or direct AI live dispatch. If metadata is lost, record the Chatwoot history message ID in the AI decision and make the human path consult that mapping, failing closed on unknown/unavailable lookup. Verify the record is not eligible for `processChatwootOutbound`. Never use Chatwoot history as the transport trigger.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/contract/chatwoot-ai-history.test.ts tests/unit/clients.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** No live Chatwoot validation is performed by this task run; no OpenAI or Telnyx call is made. If marker preservation is unavailable, retain durable decision plus marker-aware suppression as authoritative.

---

## Group 4 — Durable state and direct AI Telnyx dispatch

### T008 Add SQLite AI state, decision deduplication, and restart safety

**Files:**
- Modify: `src/db/store.ts`
- Create: `tests/integration/ai/store.test.ts`
- Modify: `tests/integration/store.test.ts`

**Interfaces produced:** `claimAiDecision`, `getAiDecision`, `setAiDecisionOutcome`, `recordAiHistoryMessage`, `recordAiTelnyxSubmission`, `markAiDecisionUnknown`, `getConversationAiState`, `ensureAiActive`, `transitionToWaitingForHuman`, and `transitionToHumanActive` with the exact signatures in `plan.md`.

- [ ] **Step 1 — Write failing tests first:** Test schema creation/reopen, one atomic decision claim, duplicate reuse, deterministic first decision ID, one history ID, one Telnyx action/message ID, `ai_active -> waiting_for_human -> human_active`, illegal return from `human_active`, restart durability, absence of raw-content columns, unique side-effect IDs, and ambiguous status refusing re-claim.
- [ ] **Step 2 — RED command:** `npx vitest run tests/integration/ai/store.test.ts tests/integration/store.test.ts`
  - Expected result: FAIL because Feature 002 tables and methods are absent.
- [ ] **Step 3 — Minimal implementation:** Add idempotent `ai_conversation_state` and `ai_decisions` tables, use SQLite transactions/conditional inserts for atomic claims, preserve all Feature 001 tables/semantics, store only IDs/outcome/status/state/model/timestamps, and make `human_active` sticky.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/integration/ai/store.test.ts tests/integration/store.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Reopen a file-backed database and prove state and dedupe survive restart; inspect schema for absence of message bodies/prompts/responses/phone/API-key columns; run `npm test`.

### T009 Implement fake/live direct AI Telnyx dispatch and approval/recipient gates

**Files:**
- Create: `src/ai/telnyx-dispatch.ts`
- Create: `tests/unit/ai/telnyx-dispatch.test.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/unit/runtime.test.ts`

**Interfaces produced:** `FakeAiTelnyxDispatcher.submit(input)` returns deterministic fake action data and records calls; `LiveAiTelnyxDispatcher.submit(input)` delegates once to `TelnyxClient.sendSms`; `createAiTelnyxDispatcher(config, telnyx, store)` selects the safe mode.

- [ ] **Step 1 — Write failing tests first:** Test fake mode zero network calls even when an HTTP Telnyx client exists, same validated text, fixed sender, authoritative recipient only, live approval false, missing/incorrect allowlist, `OUTBOUND_MODE=live` without explicit approval, suppressed recipient, `waiting_for_human`, `human_active`, duplicate/ambiguous decisions, and exactly one live submission when every gate passes.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/ai/telnyx-dispatch.test.ts tests/unit/runtime.test.ts`
  - Expected result: FAIL because the AI dispatchers and composition are absent.
- [ ] **Step 3 — Minimal implementation:** Add fake and live dispatchers, reuse only `TelnyxClient.sendSms({ from, to, text })`, derive recipient from the authoritative conversation binding, enforce suppression/state/dedupe/encoding/approval/allowlist/mode gates, use deterministic `ai-${aiDecisionId}` action IDs, and never accept sender/recipient from model output or arbitrary HTTP input. Keep end-to-end live SMS blocked until the durable AI-specific guard, sender/profile/readiness relationship, crash/restart/ambiguity handling, and aggregate live-send budget relationship are implemented. Leave the human Telnyx client behavior unchanged.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/unit/ai/telnyx-dispatch.test.ts tests/unit/runtime.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Run `npm test`; assert `OUTBOUND_MODE=fake` produces zero Telnyx network calls and no public free-form AI send route exists.

---

## Group 5 — Orchestration and narrow Feature 001 seams

### T010 Implement synchronous post-inbound AI orchestration and ambiguity handling

**Files:**
- Create: `src/ai/process-ai.ts`
- Create: `tests/integration/ai/process-ai.test.ts`
- Modify: `src/db/store.ts` only if a missing typed state method is exposed by T008
- Use: `src/ai/knowledge.ts`, `src/ai/event-selection.ts`, `src/ai/response-validation.ts`, `src/ai/escalation.ts`, `src/ai/telnyx-dispatch.ts`

**Interfaces produced:** `processAiPostInbound(input, dependencies): Promise<AiProcessResult>` and `buildPostInboundAiHook(dependencies)`.

- [ ] **Step 1 — Write failing tests first:** Test disabled AI, missing/invalid event, suppressed recipient, `waiting_for_human`, `human_active`, fake supported-answer fan-out order, escalation/fallback with zero Telnyx, provider/validation failures with zero history/Telnyx, same conversation and marker, exact same validated text to history/direct Telnyx, duplicate inbound identity, Chatwoot failure before Telnyx, ambiguous Chatwoot result, Telnyx failure/ambiguity, and restart reuse.
- [ ] **Step 2 — RED command:** `npx vitest run tests/integration/ai/process-ai.test.ts`
  - Expected result: FAIL because orchestration is absent.
- [ ] **Step 3 — Minimal implementation:** Follow this order: check AI/suppression/state; select `AI_DEFAULT_EVENT_ID`; load approved context; call OpenAI; validate SMS encoding; atomically claim one decision; pass the marker hard gate; create marked Chatwoot history; durably record history ID; only then submit direct AI Telnyx for a supported validated answer when every gate permits; record final status. Fallback, escalation, provider failure, validation failure, missing knowledge, suppression, human state, blocked approval, encoding failure, and ambiguous history outcomes create zero Telnyx submissions. On history/Telnyx ambiguity, record `unknown_needs_review` and never retry blindly. Do not store the transient customer message or response, and do not convert a completed inbound into HTTP 503 if this callback fails.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/integration/ai/process-ai.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Inspect fake call order as `OpenAI -> Chatwoot history -> direct AI Telnyx`; prove no Chatwoot webhook invocation and no duplicate decision/history/action on replay.

### T011 Add the post-inbound hook after successful Feature 001 inbound creation

**Files:**
- Modify: `src/inbound/process-inbound.ts`
- Modify: `src/app.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/integration/inbound.test.ts`
- Modify: `tests/integration/webhooks.test.ts`

**Interfaces produced:** Optional `postInbound?: (input: PostInboundAiInput) => Promise<AiProcessResult>` invoked only after a successful inbound result with stable event/message/conversation IDs.

- [ ] **Step 1 — Write failing tests first:** Prove the hook is not called for ignored/duplicate/failed inbound, is called only after Chatwoot inbound creation, receives the authoritative recipient/binding, preserves existing Feature 001 result/calls, disabled configuration causes no provider calls, and post-inbound failure leaves the inbound durable without rolling it back.
- [ ] **Step 2 — RED command:** `npx vitest run tests/integration/inbound.test.ts tests/integration/webhooks.test.ts`
  - Expected result: FAIL because the optional hook boundary is absent.
- [ ] **Step 3 — Minimal implementation:** Add the callback only at the exact post-create boundary. Resolve the recipient through `store.getPhoneForConversation(conversationId)`; if absent, do not invoke AI/Telnyx. Isolate callback errors/outcomes so a completed inbound remains completed and does not become HTTP 503; store the AI outcome separately. Keep Feature 001 responsible for inbound status/retry behavior and preserve the existing return shape.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/integration/inbound.test.ts tests/integration/webhooks.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Run the complete existing suite before marker filtering: `npm test`. Confirm only the named integration seam changed and no `C:\work\germes` path is modified.

### T012 Make the human Chatwoot outbound path marker-aware

**Files:**
- Modify: `src/outbound/process-outbound.ts`
- Modify: `tests/integration/outbound.test.ts`
- Modify: `tests/integration/webhooks.test.ts`
- Create: `tests/contract/marker-aware-webhook.test.ts`

**Interfaces produced:** Internal `hasAiGeneratedMarker(event: unknown): boolean`; marked AI records return `{ outcome: 'ignored', actionId }` before recipient lookup/Telnyx claim.

- [ ] **Step 1 — Write failing tests first:** Cover validated marked outgoing events, marker-in-body without metadata, malformed marker, normal human outgoing, automation/private/irrelevant events, and duplicate delivery. Assert marked AI events make zero Telnyx calls and do not claim Feature 001 `outbound_actions`; preserve existing human fixtures.
- [ ] **Step 2 — RED command:** `npx vitest run tests/contract/marker-aware-webhook.test.ts tests/integration/outbound.test.ts tests/integration/webhooks.test.ts`
  - Expected result: FAIL for marker cases.
- [ ] **Step 3 — Minimal implementation:** Add only the validated tri-state marker-aware early decision: absent marker preserves normal human eligibility; valid `ai_generated=true` returns ignored before recipient lookup/claim/send; present-but-malformed marker fails closed/review with zero Telnyx and no human fallback. Do not infer AI from sender names/body content, broaden human eligibility, or replace durable Feature 002 dedupe/state safeguards.
- [ ] **Step 4 — GREEN command:** `npx vitest run tests/contract/marker-aware-webhook.test.ts tests/integration/outbound.test.ts tests/integration/webhooks.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Confirm all pre-existing Feature 001 outbound tests pass and `git diff -- src/outbound/process-outbound.ts` contains only this narrow seam.

---

## Group 6 — Smoke, local live-AI, privacy, and regression gates

### T013 Add fake smoke tests proving full fan-out and zero live provider calls

**Files:**
- Create: `tests/integration/ai/fake-smoke.test.ts`
- Create: `tests/integration/ai/privacy.test.ts`
- Create: `tests/contract/feature-002-scope.test.ts`
- Modify: `package.json` only if T001 did not add the focused command
- Use: `tests/fixtures/ai/fake-smoke-config.ts` if needed

- [ ] **Step 1 — Write failing tests first:** Add synthetic inbound tests for one inbound message, one same-conversation marked AI history record, one direct fake AI Telnyx submission, one decision/history/action ID, and zero calls by live OpenAI, HTTP Chatwoot, and HTTP Telnyx adapters. Add disabled, replay, restart, provider-error, history-ambiguity, Telnyx-ambiguity, and privacy cases.
- [ ] **Step 2 — RED command:** `npx vitest run tests/integration/ai/fake-smoke.test.ts tests/integration/ai/privacy.test.ts tests/contract/feature-002-scope.test.ts`
  - Expected result: FAIL until the complete fake smoke harness and privacy/scope assertions exist.
- [ ] **Step 3 — Minimal implementation:** Compose only fake providers for fake smoke; make scope tests reject public arbitrary-recipient sends, `C:\work\germes`, second Chatwoot services, campaigns, scheduling, proactive sends, and unrelated Feature 001 rewrites. Make privacy tests inspect logs and SQLite schema/rows for forbidden keys, full numbers, bodies, prompts/context, and raw responses.
- [ ] **Step 4 — GREEN command:** `npm run test:ai -- tests/integration/ai/fake-smoke.test.ts tests/integration/ai/privacy.test.ts tests/contract/feature-002-scope.test.ts && npm run typecheck`
- [ ] **Step 5 — Verification checkpoint:** Run `npm test`; counters for all live adapters must remain zero, `AI_ENABLED=false` must make zero AI calls, and duplicate inbound identity must produce no second AI reply/history/SMS.

### T014 Add explicitly gated local live-AI test with fake Telnyx

**Files:**
- Create: `tests/integration/ai/live-openai.test.ts`
- Modify: `package.json` only if needed for `test:live-ai`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/live-ai.md` only for redacted, uncommitted evidence when separately authorized

- [ ] **Step 1 — Write failing test first:** Write a test that skips/fails closed unless `RUN_LIVE_AI_TEST=true`, `AI_ENABLED=true`, `AI_PROVIDER_MODE=live`, `AI_LIVE_OPENAI_ENABLED=true`, an externally injected `OPENAI_API_KEY`, and `OUTBOUND_MODE=fake` are present. Assert local live-AI rejects `OUTBOUND_MODE=live`, sends selected approved knowledge only, uses fake Telnyx, and writes no secret/raw response.
- [ ] **Step 2 — RED command:** `npm run test:live-ai -- tests/integration/ai/live-openai.test.ts`
  - Expected result: SKIP without the complete explicit gate and zero network calls; a deliberately incomplete gate must fail closed.
- [ ] **Step 3 — Minimal implementation:** Wire the test to the existing live adapter and local Chatwoot/fake adapters as appropriate. Use a bounded timeout and fake Telnyx; do not turn missing keys into provider calls and do not add a fallback that silently changes provider mode.
- [ ] **Step 4 — GREEN command:** Only after separate operator authorization and protected environment/secret-manager injection, run the gated live-AI test without an inline credential assignment.
  - Expected result: one bounded OpenAI request and zero Telnyx network calls. Never place the key in source control, shell history, logs, command output, or evidence.
- [ ] **Step 5 — Verification checkpoint:** If live-AI authorization is absent, leave the test skipped and record no live evidence. This task file itself never calls OpenAI or Telnyx.

### T015 Run final privacy, regression, scope, and evidence gates

**Files:**
- Create: `specs/002-jama-ai-assistant-smoke/evidence/automated-verification.md`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/completion-checklist.md`
- Modify: `README.md` only if an existing README needs local smoke command/config documentation
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md` only to record verified implementation notes, never secrets or raw provider output

- [ ] **Step 1 — Write failing coverage audit first:** Add or run a requirement-to-test audit that fails if any required config variable, adapter, event selector, state, dedupe invariant, marker filter, ambiguity rule, fake/live smoke mode, privacy rule, or safety gate lacks test coverage.
- [ ] **Step 2 — RED command:** `npx vitest run tests/unit/ai tests/contract/ai-openai-adapter.test.ts tests/contract/chatwoot-ai-history.test.ts tests/contract/marker-aware-webhook.test.ts tests/integration/ai`
  - Expected result: any uncovered or failing requirement blocks implementation completion; do not record success before all prior task GREEN checkpoints pass.
- [ ] **Step 3 — Minimal documentation implementation:** Fill evidence with sanitized commands, counts, statuses, requirement mapping, JAMA knowledge-owner/technical-maintainer review process, and reversible update/rollback procedure. Do not add runtime behavior in this task.
- [ ] **Step 4 — GREEN command:** `npm run typecheck && npm test && npm run test:integration && npm run test:ai`
  - Run the live-AI command only when separately approved and fully gated.
- [ ] **Step 5 — Verification checkpoint:** Run `git diff --check` and `git status --short`; scan changed files for secrets, full numbers, bodies, raw prompts/responses, `C:\work\germes`, second Chatwoot services, public arbitrary-recipient sends, campaigns, scheduling, and proactive AI. Confirm Feature 001 human tests remain green, AI history cannot reach `processChatwootOutbound`, fake smoke has zero live OpenAI/Telnyx calls, OpenAI errors have zero Telnyx calls, and duplicate inbound events have zero duplicate AI replies/SMS.

---

## Hard gates

0. **Reconciliation gate:** T000-T000J must be completed before implementation tasks. The current baseline remains Fastify + synchronous SQLite; no PostgreSQL/worker/queue/lease/readiness implementation may be introduced.
1. **Cross-feature exception gate:** Feature 002's versioned exception permits only one inbound-triggered AI response through the separate dispatcher. Human outbound authorization, suppression, binding, dedupe, and all campaign/proactive/arbitrary-recipient restrictions remain unchanged.
2. **Feature 001 baseline gate:** Before T011/T012, existing inbound and human outbound tests must pass. Only the post-inbound callback, explicit AI history writer, marker-aware ignore predicate, AI store methods, and runtime composition are permitted Feature 001 seams.
3. **RED-before-implementation gate:** Each task's targeted RED command must be run and observed failing for the intended missing behavior before its production implementation begins.
4. **Configuration fail-closed gate:** `AI_ENABLED=false` makes zero AI calls. `AI_ENABLED=true` with live OpenAI disabled uses fake/no-network behavior. Invalid limits, timeout, root, or event ID fail closed.
5. **Provider isolation gate:** Fake provider tests must make zero OpenAI and Telnyx network calls. `OUTBOUND_MODE=fake` is mandatory for fake smoke and local live-AI.
6. **Live OpenAI gate:** A live OpenAI adapter requires both AI live flags, `AI_PROVIDER_MODE=live`, a supplied key, bounded timeout, and explicit local-test opt-in. No ordinary suite calls OpenAI.
7. **Live SMS gate:** `OUTBOUND_MODE=live` without explicit `AI_LIVE_SMS_APPROVED=true` fails closed. Even with approval, the authoritative inbound recipient must exactly match `AI_LIVE_RECIPIENT_ALLOWLIST`, a durable AI-specific live guard must be available, sender/profile and Feature 001 readiness relationship must match, crash/restart/ambiguity handling must be proven, GSM-7/UCS-2 single-segment validation must pass, and aggregate live-send budget rules must be satisfied; no model or request may choose a recipient.
8. **Fan-out ordering gate:** OpenAI validation and SMS encoding validation precede Chatwoot history; durable history success plus the marker hard gate precede direct AI Telnyx dispatch. The AI record never enters the human Chatwoot outbound path.
9. **Failure/ambiguity gate:** OpenAI failure, invalid output, missing knowledge, fallback/escalation, suppression, human state, blocked approval, or encoding failure means zero Telnyx submissions and no raw/fabricated output. Chatwoot/Telnyx ambiguous outcomes become `unknown_needs_review` and cannot blind-retry.
10. **State gate:** `human_active` is sticky; `waiting_for_human` does not silently resume AI; Chatwoot assignment/status cannot re-enable AI. State survives SQLite restart.
11. **Exactly-once upper-bound gate:** For each inbound identity, there is at most one AI decision, history record, and Telnyx submission. Escalation/provider/validation failures intentionally produce zero Telnyx submissions.
12. **Privacy/scope gate:** No secrets, raw customer content, raw prompts/context, raw responses, full numbers, `C:\work\germes` changes, second Chatwoot deployment, or new public send surface.
13. **Live operational gate:** Any separately approved local Chatwoot validation or local live-AI test must be explicitly authorized, redacted, bounded, and absent from the default fake smoke path. This task decomposition itself performs no provider calls.

## Dependencies and execution order

```text
T000-T000J ─> T001 ─┬─> T004 ─> T005 ─┐
      ├─> T006 ─> T007 ─┼─> T010 ─> T011 ─> T012 ─> T013 ─> T014 ─> T015
      ├─> T002 ──────────┤
      └─> T003 ─> T009 ──┘
T008 ─────────────────────> T010
```

- T000-T000J establish the current-baseline, exception, marker, outcome, callback, SQLite, encoding, secret, interface, and zero-network gates.
- T001 establishes configuration and fixtures.
- T002/T003 can proceed after T001 RED evidence where they touch separate files.
- T004/T005 establish deterministic knowledge and policy before orchestration.
- T006/T007 establish provider and Chatwoot history contracts before orchestration.
- T008 establishes durable claims before any side effect orchestration.
- T009 establishes direct AI Telnyx safety gates before orchestration.
- T010 must precede the Feature 001 post-inbound seam T011.
- T012 depends on the marker representation selected by T007.
- T013 is the first full fake end-to-end proof.
- T014 is optional and separately gated; it is never a prerequisite for fake smoke completion.
- T015 is final and must include the existing Feature 001 regression suite.

## Resolved contradictions and cross-feature rules

1. **Formal exception:** Feature 002 is a separately scoped/versioned exception to Feature 001's AI/automation outbound prohibition. It permits only one inbound-triggered AI response through a separate dispatcher and does not weaken any human-path safety control.
2. **Current implementation boundary:** The interim implementation is Fastify + synchronous SQLite `BridgeStore`; it introduces no PostgreSQL, worker, queue, lease, readiness, or migration behavior and does not claim Feature 001's future architecture.
3. **Inbound-only trigger:** AI runs only after successful eligible inbound processing. Duplicate, ignored, failed, or suppressed inbound events do not invoke AI. No public AI send endpoint, arbitrary recipient input, model-selected recipient, campaign, scheduler, broadcast, or proactive send exists. `waiting_for_human` and sticky `human_active` suppress AI, and Chatwoot assignment/status cannot reactivate it.
4. **History safety:** T000B makes marker validation a hard gate. T000C uses tri-state behavior: absent marker preserves human eligibility; valid `ai_generated=true` is ignored with zero Telnyx; malformed/present-but-invalid marker fails closed/review with zero Telnyx. If metadata is lost, the durable history-message-ID lookup fallback is authoritative and unknown/unavailable lookup fails closed.
5. **Outcome upper bound:** One inbound identity has at most one AI decision, one history record, and one Telnyx submission. Only a supported validated answer can submit. Fallback/escalation, OpenAI/provider/validation failure, missing knowledge, suppression, human state, blocked approval, encoding failure, and ambiguous history produce zero Telnyx submissions. Ambiguity never blind-retries.
6. **Callback isolation:** The AI callback occurs after inbound creation/correlation; callback failure is stored separately and cannot turn the completed inbound into HTTP 503 or roll it back.
7. **Live safety:** Local live-AI uses real OpenAI, local Chatwoot, and fake Telnyx with protected key injection. End-to-end live AI SMS remains blocked until the durable AI-specific guard, sender/profile/readiness relationship, authoritative recipient, crash/restart/ambiguity handling, GSM-7/UCS-2 single-segment validation, explicit allowlist, and aggregate live budget relationship are implemented and separately approved.
8. **Privacy boundary:** New Feature 002 AI records exclude raw phones, bodies, prompts, OpenAI responses, secrets, and provider raw responses. Existing Feature 001 plaintext storage remains unchanged in the interim track.

## Completion definition

Fake-smoke implementation is complete only when T000-T000J and every later RED checkpoint precede implementation, targeted GREEN commands pass, fake smoke proves one bounded fan-out with zero real provider calls, marker hard-gate/tri-state filtering and callback isolation are proven, SQLite concurrency/restart safety passes, SMS encoding validation passes, all zero-send outcomes pass, privacy/scope scans pass, and Feature 001's existing tests remain green apart from explicitly named narrow seams. End-to-end live AI SMS is not part of fake-smoke completion and remains blocked until all live gates pass.

No code, provider call, live Chatwoot validation, secret, or `C:\work\germes` change is part of creating this task file.
