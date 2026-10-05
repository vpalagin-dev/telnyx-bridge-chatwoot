# JAMA AI Assistant Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, synchronous Feature 002 post-inbound AI fan-out that uses deterministic approved Markdown knowledge, creates one marked Chatwoot history record, and submits the same validated response through a separately guarded Telnyx AI path without changing the Feature 001 human outbound flow.

**Architecture:** The current repository baseline is a Fastify application using Node.js built-in SQLite through synchronous `BridgeStore` methods and synchronous webhook processing. It has no PostgreSQL, worker, queue, lease system, or readiness artifact. Feature 002 targets this interim baseline only: a narrow post-inbound seam invokes `processAiPostInbound` after successful inbound Chatwoot creation, records atomic AI state in SQLite, writes a separately owned Chatwoot history record, and uses a separate direct AI Telnyx dispatcher. It never relies on the human Chatwoot webhook path and does not claim to implement Feature 001's future PostgreSQL/worker architecture.

**Tech Stack:** Node.js `>=22.12.0`, TypeScript 5.9 strict mode, Vitest 5, Fastify 5, Zod 4, Node `node:sqlite`, native `fetch` with `AbortSignal.timeout`, and the `yaml` package for frontmatter parsing. No OpenAI or Telnyx call is made by this planning step.

**Spec:** `specs/002-jama-ai-assistant-smoke/spec.md`

## Global Constraints

- AI is disabled by default; `AI_ENABLED=true` alone selects a fake/no-network OpenAI path and MUST never authorize a real OpenAI request.
- A live OpenAI adapter requires `AI_ENABLED=true`, `AI_PROVIDER_MODE=live`, `AI_LIVE_OPENAI_ENABLED=true`, and an externally supplied `OPENAI_API_KEY`; tests inject `FakeOpenAiAdapter` except the explicitly gated local live-AI test.
- `AI_DEFAULT_EVENT_ID` is the only initial-smoke event selector. Do not read conversation metadata or infer an event from SMS text, fuzzy matching, embeddings, or model output.
- Knowledge is repository-owned Markdown under `specs/002-jama-ai-assistant-smoke/knowledge/`; event frontmatter has exactly `event_id`, `status`, `effective_from`, and `review_by`, and fixtures visibly say `demo/test data — not real JAMA facts`.
- The post-inbound AI operation is synchronous and runs only after Feature 001 successfully creates and correlates the inbound Chatwoot message. It must not replace, delay before, or roll back the inbound operation.
- Feature 002 SQLite state is authoritative for AI decision deduplication and cost controls. An operator human reply does not automatically suppress future AI replies; any explicit pause control is out of scope. One AI decision remains tied to each stable inbound identity.
- A stable inbound identity has at most one AI decision, one Chatwoot AI history record, and one Telnyx submission. Ambiguous side effects are `unknown_needs_review`/reviewable and are never blind-retried.
- The AI Chatwoot history record is marked with bridge-owned `ai_generated=true` only after response validation and the CHW-002-01 hard gate. If metadata is not preserved, the durable Chatwoot history-message-ID lookup fallback is required. It is not the transport trigger.
- The human path remains `Chatwoot human outgoing webhook -> processChatwootOutbound -> TelnyxClient`; AI output MUST NOT enter that path.
- Feature 002 is a separately scoped and versioned exception to Feature 001's AI/automation outbound prohibition. It permits one AI response per genuinely new eligible inbound Telnyx SMS through the Feature 002 direct dispatcher, while duplicate provider delivery is deduplicated. It does not weaken human authorization, suppression, binding, deduplication, or restrictions against campaigns, scheduling, proactive sends, broadcasts, or arbitrary recipients.
- Conversational cost controls are part of this feature: a short configurable debounce window and a durable rolling per-phone AI reply quota. Initial defaults are `AI_DEBOUNCE_MS=15000`, `AI_REPLY_LIMIT=10`, and `AI_REPLY_LIMIT_WINDOW_MS=86400000`. Human replies do not automatically pause AI; campaigns remain human-controlled and separate.
- `OUTBOUND_MODE=fake` remains the default and is mandatory for fake smoke and local live-AI mode. The canonical live OpenAI predicate is `AI_ENABLED=true AND AI_PROVIDER_MODE=live AND AI_LIVE_OPENAI_ENABLED=true AND OPENAI_API_KEY is present`; otherwise use fake/no-network behavior or fail closed.
- The canonical live AI SMS predicate is `OUTBOUND_MODE=live AND AI_LIVE_SMS_APPROVED=true AND authoritative conversation-bound recipient is in AI_LIVE_RECIPIENT_ALLOWLIST AND durable AI live guard is available AND suppression/state/encoding/readiness/deduplication checks pass`.
- Fake-only interim smoke is implementable after documentation reconciliation. Local live-AI is real OpenAI + local Chatwoot + fake Telnyx. End-to-end live AI SMS remains blocked until all live gates pass.
- No code, fixture, test, command, or documentation may modify `C:\work\germes`, create another Chatwoot deployment, add a public arbitrary-recipient endpoint, add campaigns/scheduling/proactive messages, or commit provider secrets.
- Durable records and logs exclude API keys, full phone numbers, SMS bodies, raw prompts/context, and raw OpenAI responses.
- Tests must be written and observed failing before their implementation task; every task has a targeted RED command, minimal implementation, targeted GREEN command, and verification checkpoint.

## Existing Baseline and Narrow Integration Seams

The current repository baseline is intentionally small: Fastify, Node.js built-in SQLite through `BridgeStore`, synchronous webhook processing, and no PostgreSQL, worker, queue, lease system, or readiness artifact. Feature 002 targets this baseline only and must not introduce a PostgreSQL migration or claim to satisfy Feature 001's future PostgreSQL/worker architecture. The existing Feature 001 plaintext storage remains unchanged in this interim track; full Feature 001 privacy/encryption is separate. The baseline must remain behaviorally unchanged outside the seams listed below:

- `src/inbound/process-inbound.ts:processTelnyxInbound` validates `message.received`, maps the phone to Chatwoot, creates the inbound message, and returns `{ telnyxEventId, telnyxMessageId, chatwootConversationId, chatwootMessageId }`.
- `src/chatwoot/client.ts:ChatwootClient` currently exposes contact/conversation operations and `createIncomingMessage` only; Feature 002 adds a separate `ChatwootAiHistoryWriter` interface rather than requiring current inbound fakes to implement an AI method.
- `src/chatwoot/http-client.ts:HttpChatwootClient` posts inbound messages to `POST /api/v1/accounts/{accountId}/conversations/{conversationId}/messages`; its AI history capability is composed through the separate writer contract.
- `src/telnyx/client.ts:TelnyxClient.sendSms` is the existing direct Telnyx abstraction and must be reused by the AI dispatcher rather than by the Chatwoot webhook.
- `src/db/store.ts:BridgeStore` already owns SQLite `processed_events`, `outbound_actions`, suppression, and conversation bindings.
- `src/outbound/process-outbound.ts:processChatwootOutbound` is the human path. Its only allowed Feature 002 change is an early marker-aware ignore predicate and tests proving all pre-existing human cases still pass.
- `src/app.ts:buildApp` currently invokes inbound and human outbound processing directly. The AI seam is added only after a successful inbound result, and the Chatwoot webhook route continues invoking only `processChatwootOutbound`.
- `src/runtime.ts:buildRuntime` composes real HTTP clients. Fake adapters used by smoke tests are injected in tests; runtime composition must select fake AI behavior without creating provider network clients when fake mode is active.

## Planned File Map

### Existing files modified only at the named seams

- Modify `package.json`: add `yaml`, add `test:ai`, `test:live-ai`, and preserve all Feature 001 scripts.
- Modify `src/config/env.ts`: parse and normalize the complete Feature 002 configuration contract into `BridgeConfig.ai` and `BridgeConfig.aiOutbound` without changing existing outbound defaults.
- Modify `src/db/store.ts`: add Feature 002 tables and typed methods for AI decision/state claims; do not alter existing Feature 001 table semantics.
- Modify `src/chatwoot/client.ts`: add a separate `ChatwootAiHistoryWriter` interface with explicit metadata and `ChatwootAiMessage` result types; do not force every current `ChatwootClient` fake to implement it.
- Modify `src/chatwoot/http-client.ts`: implement the explicit AI history writer operation and preserve the marker contract selected by the mandatory CHW-002-01 gate.
- Modify `src/inbound/process-inbound.ts`: accept an optional post-inbound callback and invoke it only after the inbound Chatwoot message is successfully created; existing result shapes and disabled behavior remain unchanged.
- Modify `src/outbound/process-outbound.ts`: ignore marked AI records before human eligibility/recipient lookup, while preserving all existing human predicates.
- Modify `src/app.ts`: compose the post-inbound callback and pass the AI dependencies; do not route AI records through `/webhooks/chatwoot`.
- Modify `src/runtime.ts`: compose fake/live OpenAI and fake/live AI Telnyx dispatch only after configuration gates pass.

### New Feature 002 source files

- Create `src/ai/types.ts`: shared AI domain types and provider interfaces.
- Create `src/ai/openai-fake.ts`: deterministic `FakeOpenAiAdapter`.
- Create `src/ai/openai-live.ts`: timeout-bounded native-fetch `LiveOpenAiAdapter`.
- Create `src/ai/knowledge.ts`: YAML frontmatter parser, validation, currentness checks, and repository-root confinement.
- Create `src/ai/event-selection.ts`: explicit `AI_DEFAULT_EVENT_ID` selection with no inference.
- Create `src/ai/response-validation.ts`: bridge-owned response policy checks and normalized outcomes.
- Create `src/ai/escalation.ts`: sensitive/unsupported classification and state-transition policy.
- Create `src/ai/telnyx-dispatch.ts`: fake and live direct AI Telnyx dispatch interfaces and approval/allowlist gates.
- Create `src/ai/process-ai.ts`: synchronous post-inbound orchestration and fan-out ordering.
- Create `specs/002-jama-ai-assistant-smoke/knowledge/events/event-afrorave-river.md`, `event-jama-juls.md`, and `knowledge/shared/jama-support.md`: safe demo fixtures only.

### New tests and fixtures

- Create `tests/fixtures/ai/inbound-question.json` and `tests/fixtures/ai/chatwoot-ai-history.json` with redacted IDs and no real customer/provider data.
- Create `tests/fixtures/ai/knowledge/events/*.md` only if tests need isolated malformed/expired/ambiguous documents; otherwise use the repository-owned knowledge fixtures.
- Create `tests/unit/ai/config.test.ts`, `knowledge.test.ts`, `event-selection.test.ts`, `response-validation.test.ts`, `escalation.test.ts`, and `telnyx-dispatch.test.ts`.
- Create `tests/contract/ai-openai-adapter.test.ts`, `chatwoot-ai-history.test.ts`, and `marker-aware-webhook.test.ts`.
- Create `tests/integration/ai/store.test.ts`, `process-ai.test.ts`, `fake-smoke.test.ts`, and `live-openai.test.ts`.
- Create `tests/integration/ai/privacy.test.ts` and `tests/contract/feature-002-scope.test.ts`.
- Modify `tests/unit/config.test.ts`, `tests/integration/inbound.test.ts`, `tests/integration/outbound.test.ts`, `tests/integration/webhooks.test.ts`, `tests/integration/store.test.ts`, and `tests/unit/clients.test.ts` only to extend the existing baseline with narrow seam regression assertions.

## Interfaces and Data Contracts

The implementation must use these names and shapes so later tasks have stable boundaries.

```ts
// src/ai/types.ts
export type AiConversationState = 'ai_active' | 'waiting_for_human' | 'human_active';
export type AiOutcome = 'answered' | 'fallback' | 'escalated' | 'disabled' | 'provider_error' | 'validation_error';
export type AiDecisionStatus =
  | 'claimed'
  | 'history_pending'
  | 'history_completed'
  | 'telnyx_pending'
  | 'completed'
  | 'unknown_needs_review';

export type OpenAiRequest = {
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  systemInstruction: string;
  eventId: string;
  approvedContext: string;
  customerMessage: string;
  safeFallbackText: string;
};

export type OpenAiDecision =
  | { kind: 'answer'; text: string }
  | { kind: 'fallback'; text: string; escalate: true }
  | { kind: 'error'; reason: 'timeout' | 'provider_error' | 'malformed' };

export interface OpenAiAdapter {
  generate(request: OpenAiRequest): Promise<OpenAiDecision>;
}

export type AiHistoryMetadata = {
  ai_generated: true;
  ai_decision_id: string;
  event_id: string;
  outcome: Extract<AiOutcome, 'answered' | 'fallback' | 'escalated'>;
};

export type ChatwootAiHistoryMessage = { id: number };
export interface ChatwootAiHistoryWriter {
  createAiHistoryMessage(
    conversationId: number,
    text: string,
    metadata: AiHistoryMetadata,
  ): Promise<ChatwootAiHistoryMessage>;
}

export type AiTelnyxDispatchInput = { from: string; to: string; text: string; aiDecisionId: string };
export type AiTelnyxDispatchResult = { actionId: string; telnyxMessageId: string; mode: 'fake' | 'live' };
export interface AiTelnyxDispatcher {
  submit(input: AiTelnyxDispatchInput): Promise<AiTelnyxDispatchResult>;
}

export type PostInboundAiInput = {
  inboundIdentity: string; // stable Telnyx message/event identity, never model-generated
  telnyxEventId: string;
  telnyxMessageId: string;
  conversationId: number;
  inboundMessageId: number;
  recipient: string; // resolved from Feature 001 binding, not model/webhook text
  customerMessage: string; // transient only; never stored/logged
};

export type AiProcessResult = {
  outcome: AiOutcome | 'duplicate' | 'suppressed' | 'human_active' | 'waiting_for_human' | 'unknown_needs_review';
  aiDecisionId: string;
  state: AiConversationState;
};
```

`BridgeStore` must expose these Feature 002 methods without leaking raw content:

```ts
claimAiDecision(input: {
  inboundIdentity: string;
  conversationId: number;
  inboundMessageId: number;
  eventId: string;
  aiDecisionId: string;
}): { claimed: true; decisionId: string } | { claimed: false; decisionId: string; status: AiDecisionStatus };
getAiDecision(inboundIdentity: string): AiDecisionRecord | null;
setAiDecisionOutcome(decisionId: string, update: { outcome: AiOutcome; status: AiDecisionStatus; state: AiConversationState }): void;
recordAiHistoryMessage(decisionId: string, chatwootHistoryMessageId: number): void;
recordAiTelnyxSubmission(decisionId: string, actionId: string, telnyxMessageId: string): void;
markAiDecisionUnknown(decisionId: string, reason: 'chatwoot_history' | 'telnyx_submission' | 'provider'): void;
getConversationAiState(conversationId: number): AiConversationState | null;
ensureAiActive(conversationId: number): boolean;
transitionToWaitingForHuman(conversationId: number, decisionId: string): void;
transitionToHumanActive(conversationId: number, takeoverId: string): void;
```

The exact `AiDecisionRecord` columns are: `inbound_identity`, `conversation_id`, `inbound_message_id`, `event_id`, `ai_decision_id`, nullable `chatwoot_history_message_id`, nullable `telnyx_action_id`, nullable `telnyx_message_id`, `outcome`, `status`, `state`, `model`, `created_at`, `updated_at`, and `unknown_reason`. Do not add raw message, prompt, context, response, phone, API key, or provider response columns.

## Approved Fan-Out Sequence

`processTelnyxInbound` remains the owner of the existing inbound side effect. After it returns `outcome: 'created'`, the narrow callback invokes:

1. `processAiPostInbound` checks `AI_ENABLED`, existing Feature 001 suppression, same-contact conversation binding, debounce/quota eligibility, and the current inbound identity.
2. `selectDefaultEvent(config.ai.defaultEventId, knowledgeRepository)` resolves exactly one current approved document. Missing/unknown/disabled/expired/ambiguous event fails closed without calling OpenAI.
3. `loadApprovedKnowledge` returns only the selected event document plus approved shared support text; it rejects unsafe root escape, invalid frontmatter, draft status, future `effective_from`, and expired `review_by`.
4. `OpenAiAdapter.generate` receives bounded limits, a fixed system instruction, selected event ID/context, the current customer message, and fallback policy. It never receives another event or general retrieval result.
5. `validateAiDecision` rejects empty, malformed, over-limit, unsupported, injection-following, or context-unverifiable output and converts it to the configured safe fallback/escalation outcome.
6. The SQLite store atomically claims exactly one decision before any AI side effect. For an accepted supported answer, the bridge adds `ai_generated: true` immediately before `createAiHistoryMessage` and writes the answer to the same conversation. Fallback/escalation may create only the explicitly approved safe escalation representation and never creates a transport-enabling outcome.
7. Only after the marker contract is validated and the history side effect is durably known complete does `AiTelnyxDispatcher.submit` send the exact same validated supported answer. Fake mode records a deterministic fake action without network. Live mode requires the canonical live-SMS predicate, durable AI-specific guard, sender/profile and readiness relationship, authoritative recipient, suppression/state/encoding checks, and no prior action.
8. The store records IDs and final outcome. A duplicate identity returns the prior result and makes zero additional AI, Chatwoot, or Telnyx calls. A successful inbound must not become HTTP 503 because this callback fails; AI failure is stored separately.

If Chatwoot history creation is rejected before dispatch, record `unknown_needs_review` or a review outcome and make zero Telnyx calls. If the HTTP result is ambiguous, do not issue a duplicate history request and fail closed until the marker or durable message-ID fallback resolves it. If Telnyx submission is ambiguous, record `unknown_needs_review` and do not submit again. OpenAI errors, invalid responses, missing knowledge, suppression, human state, blocked approval, and validation failures create zero Telnyx submissions and never post raw or fabricated content.

## Task-by-Task TDD Sequence

### Reconciliation gates before implementation

These gates are documentation and test-planning prerequisites. They must be completed before any provider or Feature 001 seam implementation begins.

### Task 0: Reconcile the current repository baseline

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/spec.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md`
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/feature-002-baseline.test.ts`

- [ ] **Step 1 — RED:** Add a scope test proving the selected interim baseline is Fastify + synchronous `BridgeStore`/SQLite, with no PostgreSQL, worker, queue, lease, or readiness artifact, and that Feature 002 does not add those systems.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/feature-002-baseline.test.ts`; expected failure until the baseline assertions and scope contract exist.
- [ ] **Step 3 — Reconcile:** Record that Feature 002 is interim smoke-only and does not satisfy Feature 001's future PostgreSQL/worker plan. Do not add a PostgreSQL migration.
- [ ] **Step 4 — GREEN:** Run the baseline scope test and `npm run typecheck` after the documentation contract is represented in the test fixture.

### Task 0A: Formalize the cross-feature exception

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/spec.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md`
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/feature-002-exception.test.ts`

- [ ] **Step 1 — RED:** Add assertions for the exact exception boundary: one inbound-triggered AI response, separate direct dispatcher, no human-path weakening, no campaigns/scheduler/proactive/broadcast/arbitrary recipients.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/feature-002-exception.test.ts`; expected failure until the cross-feature contract is recorded.
- [ ] **Step 3 — Reconcile:** Make the exception versioned, scoped, and subordinate to all Feature 001 human safety controls.
- [ ] **Step 4 — GREEN:** Run the exception contract test and the existing human outbound tests.

### Task 0B: Make the Chatwoot marker contract a hard gate

**Files:**
- Modify: `src/chatwoot/client.ts`
- Modify: `src/chatwoot/http-client.ts`
- Create: `tests/contract/chatwoot-ai-marker-gate.test.ts`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/chatwoot-ai-history-validation.md`

- [ ] **Step 1 — RED:** Test that AI history/live dispatch cannot be enabled until marker preservation is validated, or until the durable Chatwoot-message-ID lookup fallback is available.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/chatwoot-ai-marker-gate.test.ts`; expected failure before the gate exists.
- [ ] **Step 3 — Implement the gate contract:** Use `ChatwootAiHistoryWriter`; if metadata is lost, persist the Chatwoot history message ID in the AI decision and make the human path consult it. Unknown/unavailable lookup fails closed.
- [ ] **Step 4 — GREEN:** Run the marker gate test without local Chatwoot, OpenAI, or Telnyx calls.

### Task 0C: Define tri-state marker filtering

**Files:**
- Modify: `src/outbound/process-outbound.ts`
- Create: `tests/contract/marker-aware-webhook.test.ts`

- [ ] **Step 1 — RED:** Add cases for absent marker, valid `ai_generated=true`, marker in body only, and present-but-malformed marker.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/marker-aware-webhook.test.ts`; expected failure for AI marker cases.
- [ ] **Step 3 — Implement:** Absent marker continues normal human eligibility; valid marker returns ignored before recipient lookup/claim/send; malformed marker fails closed/review with zero Telnyx and no human fallback.
- [ ] **Step 4 — GREEN:** Run the contract test and all existing outbound tests.

### Task 0D: Add the closed fallback/outcome matrix

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/spec.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md`
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/ai-outcome-matrix.test.ts`

- [ ] **Step 1 — RED:** Assert supported answer → at most one history and one submission; fallback/escalation/provider/validation/missing-knowledge/suppressed/human/blocked/ambiguous-history outcomes → zero Telnyx submissions.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/ai-outcome-matrix.test.ts`; expected failure until orchestration policy is defined.
- [ ] **Step 3 — Reconcile:** Keep “at most one” as an upper bound and prohibit raw/fabricated output.
- [ ] **Step 4 — GREEN:** Run the matrix test with fake adapters only.

### Task 0E: Specify callback failure isolation

**Files:**
- Modify: `src/inbound/process-inbound.ts`
- Modify: `src/app.ts`
- Modify: `src/runtime.ts`
- Create: `tests/integration/ai/post-inbound-isolation.test.ts`

- [ ] **Step 1 — RED:** Test that a completed inbound remains completed and does not return HTTP 503 when the AI callback throws or times out; test that duplicate delivery cannot create a second AI decision.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/integration/ai/post-inbound-isolation.test.ts`; expected failure before the isolated callback seam exists.
- [ ] **Step 3 — Implement:** Invoke AI only after successful inbound creation/correlation, store AI outcome separately, and preserve the successful inbound result/ack.
- [ ] **Step 4 — GREEN:** Run the isolation test and existing inbound/webhook tests.

### Task 0F: Prove SQLite atomicity and concurrency boundaries

**Files:**
- Modify: `src/db/store.ts`
- Create: `tests/integration/ai/sqlite-concurrency.test.ts`

- [ ] **Step 1 — RED:** Test concurrent claims, unique inbound identity, one history ID, one AI action ID, restart durability, debounce/quota state, later inbound after human reply, and non-reclaim of unknown/ambiguous decisions.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/integration/ai/sqlite-concurrency.test.ts`; expected failure because AI tables/methods do not exist.
- [ ] **Step 3 — Implement:** Use SQLite transactions/conditional uniqueness within `DatabaseSync`; do not claim PostgreSQL or cross-store locking.
- [ ] **Step 4 — GREEN:** Run the concurrency test against a file-backed SQLite database and reopen it.

### Task 0G: Add SMS encoding and single-segment validation

**Files:**
- Create: `src/ai/sms-validation.ts`
- Create: `tests/unit/ai/sms-validation.test.ts`

- [ ] **Step 1 — RED:** Cover GSM-7 boundaries, extension characters, UCS-2/non-GSM text, empty text, and multi-segment rejection.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/unit/ai/sms-validation.test.ts`; expected failure because the validator is absent.
- [ ] **Step 3 — Implement:** Validate the final supported answer before history/Telnyx side effects; reject unsafe encoding and segment counts.
- [ ] **Step 4 — GREEN:** Run the validator tests and typecheck.

### Task 0H: Protect live-AI secret injection

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/tasks.md`
- Create: `tests/contract/live-ai-gates.test.ts`

- [ ] **Step 1 — RED:** Assert missing/incomplete live gates skip or fail closed and that no test command embeds `OPENAI_API_KEY` inline or writes it to evidence.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/live-ai-gates.test.ts`; expected failure until the protected-injection contract is documented.
- [ ] **Step 3 — Reconcile:** Require protected environment/secret-manager injection; never use inline shell assignment, shell history, logs, or evidence.
- [ ] **Step 4 — GREEN:** Run the gate test without a key and without network access.

### Task 0I: Preserve interface compatibility

**Files:**
- Modify: `src/chatwoot/client.ts`
- Modify: `src/config/env.ts`
- Modify: `tests/unit/runtime.test.ts`
- Modify: `tests/integration/webhooks.test.ts`
- Create: `tests/contract/feature-002-interfaces.test.ts`

- [ ] **Step 1 — RED:** Prove existing `ChatwootClient` fakes remain valid through the separate `ChatwootAiHistoryWriter`, and all typed `BridgeConfig` fixtures include the new AI fields without changing human outbound defaults.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/feature-002-interfaces.test.ts tests/unit/runtime.test.ts tests/integration/webhooks.test.ts`; expected type/contract failures before compatibility updates.
- [ ] **Step 3 — Implement:** Compose AI history separately and update every existing config fixture explicitly.
- [ ] **Step 4 — GREEN:** Run the interface tests and typecheck.

### Task 0J: Prove exact zero-network fake behavior

**Files:**
- Create: `tests/contract/feature-002-zero-network.test.ts`
- Create: `tests/integration/ai/fake-provider-isolation.test.ts`

- [ ] **Step 1 — RED:** Assert fake smoke constructs no live OpenAI/Telnyx network path, makes no HTTP Chatwoot call, and makes zero network calls for every failure/escalation/blocked case.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/feature-002-zero-network.test.ts tests/integration/ai/fake-provider-isolation.test.ts`; expected failure until composition and fake adapters exist.
- [ ] **Step 3 — Implement:** Inject fake providers and make all network clients unreachable from fake smoke.
- [ ] **Step 4 — GREEN:** Run the tests with network-capable clients composed but no network invocation.

### Task 1: Add Feature 002 dependencies, configuration contract, and safe fixture layout

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/runtime.test.ts`
- Modify: `tests/integration/webhooks.test.ts`
- Create: `tests/unit/ai/config.test.ts`
- Create: `specs/002-jama-ai-assistant-smoke/knowledge/events/event-afrorave-river.md`
- Create: `specs/002-jama-ai-assistant-smoke/knowledge/events/event-jama-juls.md`
- Create: `specs/002-jama-ai-assistant-smoke/knowledge/shared/jama-support.md`

**Interfaces:**
- `loadConfig(environment)` returns `BridgeConfig.ai` and `BridgeConfig.aiOutbound` with normalized booleans, positive bounded limits, and repository-confined `knowledgeRoot`.
- `AI_PROVIDER_MODE` is exactly `fake|live`; default `fake`.
- `AI_LIVE_RECIPIENT_ALLOWLIST` parses a comma-separated E.164 list, trims whitespace, rejects invalid entries, and never logs values.

- [ ] **Step 1 — RED:** Add tests covering defaults (`AI_ENABLED=false`, provider `fake`, model `gpt-4o-mini`, fallback text, escalation enabled, AI live SMS approval false), enabled fake mode without `OPENAI_API_KEY`, live mode requiring both live flags and key, invalid bounds, missing `AI_DEFAULT_EVENT_ID`, invalid knowledge root, `AI_LIVE_SMS_APPROVED` without live outbound, allowlist parsing, and mandatory fake outbound for fake/local live-AI.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/unit/ai/config.test.ts tests/unit/config.test.ts`; expected failures are missing `BridgeConfig.ai`/new validation only.
- [ ] **Step 3 — Implement:** Add `yaml@2.8.1` with `npm install yaml@2.8.1 --save-exact`; extend `src/config/env.ts` with `AI_ENABLED`, `AI_PROVIDER_MODE`, `AI_LIVE_OPENAI_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_INPUT_TOKENS` default `2048`, `OPENAI_MAX_OUTPUT_TOKENS` default `256`, `OPENAI_TIMEOUT_MS` default `5000`, `AI_DEFAULT_EVENT_ID`, `AI_KNOWLEDGE_ROOT` default `specs/002-jama-ai-assistant-smoke/knowledge`, `AI_SAFE_FALLBACK_TEXT` default `I'm not sure about that. Let me get someone from the JAMA team to help you.`, `AI_ESCALATION_ENABLED` default `true`, `AI_LIVE_SMS_APPROVED` default `false`, and `AI_LIVE_RECIPIENT_ALLOWLIST` default empty. Enforce live OpenAI key requirements only when both live flags enable it; require `AI_DEFAULT_EVENT_ID` and a repository-confined knowledge root whenever AI is enabled; enforce live AI SMS approval/allowlist only for actual live AI Telnyx dispatch; preserve Feature 001 config behavior. Add exact package scripts: `test:ai` runs `vitest run tests/unit/ai tests/contract/ai-openai-adapter.test.ts tests/contract/chatwoot-ai-history.test.ts tests/contract/marker-aware-webhook.test.ts tests/integration/ai --exclude tests/integration/ai/live-openai.test.ts`, and `test:live-ai` runs `vitest run tests/integration/ai/live-openai.test.ts`.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/unit/ai/config.test.ts tests/unit/config.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Confirm `AI_ENABLED=true` with no live flags performs no key requirement and `OUTBOUND_MODE` still defaults to `fake`; run `git diff --check` and `npm test`.

### Task 2: Establish approved Markdown knowledge loading and deterministic event selection

**Files:**
- Create: `src/ai/knowledge.ts`
- Create: `src/ai/event-selection.ts`
- Create: `tests/unit/ai/knowledge.test.ts`
- Create: `tests/unit/ai/event-selection.test.ts`
- Create: `tests/fixtures/ai/knowledge/events/expired.md`
- Create: `tests/fixtures/ai/knowledge/events/draft.md`
- Create: `tests/fixtures/ai/knowledge/events/duplicate-event-id.md`

**Interfaces:**
- `loadApprovedKnowledge(root: string, eventId: string, now: Date): Promise<ApprovedKnowledge>`.
- `selectDefaultEvent(eventId: string | undefined, loader: KnowledgeLoader, now: Date): Promise<EventSelection>`.
- `ApprovedKnowledge` contains `eventId`, validated frontmatter, event markdown body, and explicitly approved shared markdown; it contains no unrelated event content.

- [ ] **Step 1 — RED:** Test exact required frontmatter keys (`event_id`, `status`, `effective_from`, `review_by`), unique matching IDs, approved/current status, effective/review date boundaries, visible demo label, root traversal rejection, malformed YAML, duplicate event IDs, missing ID, body-only ID, and no OpenAI-selection callback.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/unit/ai/knowledge.test.ts tests/unit/ai/event-selection.test.ts`; expected failure is missing loader/selector.
- [ ] **Step 3 — Implement:** Use `parseDocument` from `yaml`, reject unknown/missing frontmatter keys for event files, require `status: approved`, parse ISO dates, require `effective_from <= now < review_by`, confine resolved paths under `AI_KNOWLEDGE_ROOT`, require the requested opaque ID to match exactly one file, and load only `shared/jama-support.md` plus that event file. Require the visible phrase `demo/test data` and `not real JAMA facts` in initial fixtures. Do not inspect inbound text or conversation metadata.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/unit/ai/knowledge.test.ts tests/unit/ai/event-selection.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Run `git diff --check` and `npm test` after confirming no secrets/full customer data are present in the Markdown fixtures; inspect the selected context in tests to prove no unrelated event document is loaded.

### Task 3: Define provider interfaces and implement fake OpenAI plus live OpenAI adapter

**Files:**
- Create: `src/ai/types.ts`
- Create: `src/ai/openai-fake.ts`
- Create: `src/ai/openai-live.ts`
- Create: `tests/contract/ai-openai-adapter.test.ts`
- Create: `tests/unit/ai/openai-live.test.ts`

**Interfaces:**
- Implement `OpenAiAdapter.generate(request: OpenAiRequest): Promise<OpenAiDecision>`.
- `FakeOpenAiAdapter` constructor accepts a scripted `OpenAiDecision` or function and exposes safe request metadata capture (`model`, token limits, event ID), never raw prompt persistence.
- `LiveOpenAiAdapter` constructor accepts `{ apiKey, model, timeoutMs, fetcher? }` and uses one native `fetch` call with `AbortSignal.timeout(timeoutMs)`.

- [ ] **Step 1 — RED:** Add contract tests for fake deterministic answer/fallback/error, live request shape, bearer authentication, model/limits, fixed system instruction, timeout abort, HTTP/rate-limit failure, malformed response, one request only, and secret-safe errors. Add an assertion that `AI_ENABLED=true` with live OpenAI disabled never constructs/calls the live adapter.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/ai-openai-adapter.test.ts tests/unit/ai/openai-live.test.ts`; expected missing-module failures.
- [ ] **Step 3 — Implement:** Make `FakeOpenAiAdapter` return its scripted result without network. Make `LiveOpenAiAdapter` POST `https://api.openai.com/v1/chat/completions` with `{ model, messages: [{role:'system',content:...},{role:'user',content:...}], max_tokens: maxOutputTokens }`, bounded input preflight, authorization header, no retries, and normalized `timeout|provider_error|malformed` results. Never include API keys or raw provider bodies in errors/logs.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/contract/ai-openai-adapter.test.ts tests/unit/ai/openai-live.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Verify the adapter contract can be fully faked and run `npm test`; no test may require `OPENAI_API_KEY`.

### Task 4: Add AI Chatwoot history operation and complete CHW-002-01 validation

**Files:**
- Modify: `src/chatwoot/client.ts`
- Modify: `src/chatwoot/http-client.ts`
- Create: `tests/contract/chatwoot-ai-history.test.ts`
- Modify: `tests/unit/clients.test.ts`
- Create: `tests/fixtures/ai/chatwoot-ai-history.json`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/chatwoot-ai-history-validation.md`

**Interfaces:**
- `HttpChatwootClient.createAiHistoryMessage(conversationId, text, metadata): Promise<{ id: number }>` implements `ChatwootAiHistoryWriter`.
- The request is `POST /api/v1/accounts/{accountId}/conversations/{conversationId}/messages` with an outgoing/history payload and explicit marker metadata selected by validation. The adapter must not call Telnyx.

- [ ] **Step 1 — RED:** Add fake-client and HTTP contract tests proving same conversation, `ai_generated=true` marker, AI decision/event metadata, no human webhook dependency, secret-safe response handling, and no raw response persistence. Add a regression assertion that existing `createIncomingMessage` payload is unchanged.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/chatwoot-ai-history.test.ts tests/unit/clients.test.ts`; expected missing method failures.
- [ ] **Step 3 — Implement:** Add the separate writer method and payload parser. Before enabling AI history creation or direct AI live dispatch, perform the isolated local validation against the already configured Chatwoot only if an operator separately authorizes it; capture only redacted message/webhook evidence in `evidence/chatwoot-ai-history-validation.md`. If metadata is not preserved, implement the concrete durable Chatwoot-message-ID lookup fallback: record the history ID in the AI decision and make the human path consult it, failing closed on unknown/unavailable lookup.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/contract/chatwoot-ai-history.test.ts tests/unit/clients.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Do not run local Chatwoot, OpenAI, or Telnyx from this planning task. During implementation, the validation must use no public ingress, no Telnyx client, and no real OpenAI key.

### Task 5: Add durable SQLite AI state and decision deduplication

**Files:**
- Modify: `src/db/store.ts`
- Create: `tests/integration/ai/store.test.ts`
- Modify: `tests/integration/store.test.ts`

**Interfaces:**
- Add durable AI decision, debounce, and rolling per-phone quota state keyed by inbound identity/phone; human replies do not automatically pause future AI replies.
- Add `ai_decisions` keyed by `inbound_identity`, with the exact columns listed above and unique nullable-side-effect IDs.
- Implement the `BridgeStore` methods in the Interfaces section; all claims must be atomic under SQLite transactions.

- [ ] **Step 1 — RED:** Test schema creation/reopen, one decision claim, duplicate reuse, one history ID, one Telnyx action ID, durable AI decision state, later inbound after human reply, restart durability, debounce and rolling quota, no raw content columns, and ambiguous status refusing re-claim.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/integration/ai/store.test.ts tests/integration/store.test.ts`; expected missing table/method failures.
- [ ] **Step 3 — Implement:** Extend `BridgeStore` initialization with idempotent Feature 002 tables and transactional `INSERT OR IGNORE`/conditional updates. Preserve existing Feature 001 APIs and rows. Use a generated deterministic `aiDecisionId` only for the first claim; duplicate calls return the stored ID/status. Store model/outcome/state metadata only.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/integration/ai/store.test.ts tests/integration/store.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Reopen a file-backed SQLite database and prove state/decision dedupe survives restart; run `npm test`.

### Task 6: Implement response validation and escalation/state policy

**Files:**
- Create: `src/ai/response-validation.ts`
- Create: `src/ai/escalation.ts`
- Create: `tests/unit/ai/response-validation.test.ts`
- Create: `tests/unit/ai/escalation.test.ts`

**Interfaces:**
- `validateAiDecision(decision: OpenAiDecision, policy: ResponseValidationPolicy): ValidatedAiDecision`.
- `classifyEscalation(customerMessage: string): EscalationCategory | null`.
- `transitionForOutcome(outcome: ValidatedAiDecision): { state: AiConversationState; outcome: AiOutcome }`.

- [ ] **Step 1 — RED:** Cover known answer, empty/over-limit/malformed output, unsupported claims, prompt injection, fallback, refunds/payments, complaints, safety/emergency/harassment/threats, VIP/artist access, partnership/sponsorship, press/media, unsupported/account-specific questions, disabled escalation test-only behavior, and durable conversational cost-control state.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/unit/ai/response-validation.test.ts tests/unit/ai/escalation.test.ts`; expected missing functions.
- [ ] **Step 3 — Implement:** Enforce trimmed non-empty SMS-safe text, configured output bounds, no model-controlled event/routing fields, explicit answer/fallback/error kinds, deterministic escalation categories, configured fallback text, and state transitions. Escalation/fallback becomes `waiting_for_human`; accepted supported answer remains `ai_active`; provider/validation failure creates no sendable answer.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/unit/ai/response-validation.test.ts tests/unit/ai/escalation.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Assert logs and returned errors contain categories/IDs only, never model text; run `npm test`.

### Task 7: Implement fake/live AI Telnyx dispatch and safety gates

**Files:**
- Create: `src/ai/telnyx-dispatch.ts`
- Create: `tests/unit/ai/telnyx-dispatch.test.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/unit/runtime.test.ts`

**Interfaces:**
- `FakeAiTelnyxDispatcher.submit(input)` returns `fake-ai-${aiDecisionId}` and records calls without invoking `TelnyxClient` or network.
- `LiveAiTelnyxDispatcher.submit(input)` delegates once to `TelnyxClient.sendSms` only after the constructor/configuration safety gate passes.
- `createAiTelnyxDispatcher(config, telnyx, store)` selects fake for `OUTBOUND_MODE=fake`, and live only after the durable AI-specific guard, sender/profile and Feature 001 readiness relationship, exact authoritative allowlist, state/suppression/encoding checks, crash/restart/ambiguity policy, aggregate live-send budget relationship, and explicit approval pass.

- [ ] **Step 1 — RED:** Test zero fake network calls, same validated text, fixed sender, authoritative recipient only, fake mode even with an HTTP Telnyx client composed, live approval false, missing/incorrect allowlist, suppressed recipient, waiting/human state, duplicate/ambiguous decisions, and one live submission.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/unit/ai/telnyx-dispatch.test.ts tests/unit/runtime.test.ts`; expected missing dispatcher/composition failures.
- [ ] **Step 3 — Implement:** Add fake and live dispatchers. Reuse `TelnyxClient.sendSms({ from, to, text })`; never accept recipient or sender from the model or arbitrary HTTP input. Use deterministic action ID `ai-${aiDecisionId}`. Keep end-to-end live dispatch blocked until the durable guard, sender/profile/readiness relationship, exact allowlist, crash/restart/ambiguity handling, encoding validation, and aggregate budget relationship are implemented. Do not alter the existing human `createTelnyxClient` fake behavior; add a separate AI dispatcher selection.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/unit/ai/telnyx-dispatch.test.ts tests/unit/runtime.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Run `npm test`; verify no route exposes a free-form AI send operation.

### Task 8: Implement synchronous post-inbound AI orchestration

**Files:**
- Create: `src/ai/process-ai.ts`
- Create: `tests/integration/ai/process-ai.test.ts`
- Create: `tests/fixtures/ai/inbound-question.json`

**Interfaces:**
- `processAiPostInbound(input: PostInboundAiInput, dependencies: { config: BridgeConfig['ai']; store: BridgeStore; openai: OpenAiAdapter; chatwoot: ChatwootAiHistoryWriter; telnyx: AiTelnyxDispatcher; knowledgeLoader: KnowledgeLoader }): Promise<AiProcessResult>`.
- `buildPostInboundAiHook(dependencies)` returns `(input: PostInboundAiInput) => Promise<AiProcessResult>`.

- [ ] **Step 1 — RED:** Test disabled AI, missing/invalid event, suppressed recipient, waiting/human state, fake answer fan-out order, fallback escalation with zero Telnyx, provider/validation failures with zero history/Telnyx, same conversation and marker, exact same text to history/Telnyx, duplicate inbound identity, Chatwoot failure before Telnyx, ambiguous Chatwoot result, Telnyx failure/ambiguity, and restart reuse.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/integration/ai/process-ai.test.ts`; expected missing orchestration.
- [ ] **Step 3 — Implement:** Follow the Approved Fan-Out Sequence exactly. Atomically claim the decision before AI side effects; only record `history_pending` after provider validation; create marked history only after the marker hard gate; record its ID; then submit Telnyx only for a supported validated answer. Fallback, escalation, provider failure, validation failure, missing knowledge, suppression, human state, blocked approval, encoding failure, and ambiguous history outcomes must create zero Telnyx submissions. Do not store the customer message or response. The post-inbound callback must return a safe AI outcome without converting a completed inbound into an HTTP 503.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/integration/ai/process-ai.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Run `npm test` and inspect call order in the fake adapters: `OpenAI -> Chatwoot history -> direct AI Telnyx`, with no Chatwoot webhook invocation.

### Task 9: Add the post-inbound integration seam without changing Feature 001 behavior

**Files:**
- Modify: `src/inbound/process-inbound.ts`
- Modify: `src/app.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/integration/inbound.test.ts`
- Modify: `tests/integration/webhooks.test.ts`

**Interfaces:**
- Extend `processTelnyxInbound` dependencies with optional `postInbound?: (input: PostInboundAiInput) => Promise<AiProcessResult>`.
- Invoke the hook only after successful `createIncomingMessage` and only for `outcome: 'created'`; return the existing inbound result shape and never roll back a completed inbound message.

- [ ] **Step 1 — RED:** Add regression tests proving AI hook is not called for ignored/duplicate/failed inbound, is called after Chatwoot inbound creation with stable event/message/conversation IDs, disabled config yields no provider call, existing Feature 001 result/calls remain unchanged, and post-inbound failure leaves inbound durable while returning a safe service result.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/integration/inbound.test.ts tests/integration/webhooks.test.ts`; expected missing hook behavior.
- [ ] **Step 3 — Implement:** Build the hook in `runtime.ts`/`app.ts` and call it at the exact post-create boundary. Resolve recipient through `store.getPhoneForConversation(conversationId)`; if absent, do not call AI/Telnyx. Keep `processTelnyxInbound` responsible for Feature 001 inbound status and retain its existing retry/unknown behavior.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/integration/inbound.test.ts tests/integration/webhooks.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Run the complete existing suite before adding marker filtering: `npm test`; no `C:\work\germes` path may occur in changed files.

### Task 10: Make the existing human Chatwoot webhook marker-aware

**Files:**
- Modify: `src/outbound/process-outbound.ts`
- Modify: `tests/integration/outbound.test.ts`
- Modify: `tests/integration/webhooks.test.ts`
- Create: `tests/contract/marker-aware-webhook.test.ts`

**Interfaces:**
- Add an internal `hasAiGeneratedMarker(event: unknown): boolean` predicate that recognizes the validated Chatwoot marker locations (`ai_generated === true` in the selected metadata/custom-attributes representation) and fails closed when marker metadata is malformed.
- `processChatwootOutbound` returns `{ outcome: 'ignored', actionId }` for marked AI records before recipient lookup or `TelnyxClient.sendSms`.

- [ ] **Step 1 — RED:** Add marked outgoing events, marker-in-body/no-marker, malformed marker, human outgoing, automation, and duplicate tests. Assert marked AI records produce zero Telnyx calls and do not claim `outbound_actions`; preserve existing human fixture behavior exactly.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/contract/marker-aware-webhook.test.ts tests/integration/outbound.test.ts tests/integration/webhooks.test.ts`; expected marker cases fail.
- [ ] **Step 3 — Implement:** Add only the marker-aware early filter. Do not broaden the human path, infer AI from sender names/content, or use the marker as the authoritative dedupe/safety control.
- [ ] **Step 4 — GREEN:** `npx vitest run tests/contract/marker-aware-webhook.test.ts tests/integration/outbound.test.ts tests/integration/webhooks.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Confirm every pre-existing Feature 001 outbound test still passes and `git diff -- src/outbound/process-outbound.ts` contains only the named seam.

### Task 11: Build fake smoke harness and prove zero live provider calls

**Files:**
- Create: `tests/integration/ai/fake-smoke.test.ts`
- Create: `tests/integration/ai/privacy.test.ts`
- Create: `tests/contract/feature-002-scope.test.ts`
- Modify: `package.json`
- Create: `tests/fixtures/ai/fake-smoke-config.ts` if a shared fixture is needed

**Interfaces:**
- Add `npm run test:ai -- tests/integration/ai/fake-smoke.test.ts` for fake-only Feature 002 tests.
- Fake smoke composes `FakeOpenAiAdapter`, fake Chatwoot inbound/history adapter, `FakeAiTelnyxDispatcher`, and an in-memory `BridgeStore`.

- [ ] **Step 1 — RED:** Add an end-to-end synthetic inbound test asserting one inbound message, one marked same-conversation AI history record, one direct fake AI Telnyx submission, one decision, one history ID, one action ID, and zero calls by `LiveOpenAiAdapter`, `HttpChatwootClient`, and `HttpTelnyxClient`. Add replay/restart and disabled cases.
- [ ] **Step 2 — Run RED:** `npx vitest run tests/integration/ai/fake-smoke.test.ts tests/integration/ai/privacy.test.ts tests/contract/feature-002-scope.test.ts`; expected missing harness behavior.
- [ ] **Step 3 — Implement:** Add the fake smoke script/config and fixtures. Make scope tests scan source/config for public arbitrary-recipient AI sends, `C:\work\germes`, second Chatwoot services, campaigns, scheduler, proactive sends, and accidental Feature 001 rewrites. Make privacy tests inspect captured logs and SQLite schema/rows for forbidden bodies, prompts, contexts, keys, full numbers, and raw provider output.
- [ ] **Step 4 — GREEN:** `npm run test:ai -- tests/integration/ai/fake-smoke.test.ts tests/integration/ai/privacy.test.ts tests/contract/feature-002-scope.test.ts && npm run typecheck`.
- [ ] **Step 5 — Verification checkpoint:** Run `npm test`; record that all fake smoke provider call counters are zero for real adapters and no real secret is present.

### Task 12: Add explicitly gated local live-AI test with fake Telnyx

**Files:**
- Create: `tests/integration/ai/live-openai.test.ts`
- Modify: `package.json`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/live-ai.md` (uncommitted or redacted evidence only)

**Interfaces:**
- Add `npm run test:live-ai -- tests/integration/ai/live-openai.test.ts`.
- The test is skipped unless `RUN_LIVE_AI_TEST=true`, `AI_ENABLED=true`, `AI_PROVIDER_MODE=live`, `AI_LIVE_OPENAI_ENABLED=true`, a valid externally injected `OPENAI_API_KEY`, and `OUTBOUND_MODE=fake` are all present.

- [ ] **Step 1 — RED:** Write the gated test before implementation that asserts missing gate variables skip/fail closed, `OUTBOUND_MODE=live` is rejected for local live-AI, the real adapter receives only selected approved knowledge, fake Telnyx records zero real calls, and no secret/raw response is written to evidence.
- [ ] **Step 2 — Run RED:** `npm run test:live-ai -- tests/integration/ai/live-openai.test.ts`; expected SKIP without `RUN_LIVE_AI_TEST=true` and no network call.
- [ ] **Step 3 — Implement:** Wire the test to the already implemented live adapter and local Chatwoot/fake adapters as appropriate; do not add a fallback that silently turns a missing key into a provider call. Use a bounded timeout and a test-specific fake Telnyx dispatcher.
- [ ] **Step 4 — GREEN:** With an operator separately injecting the key through a protected environment/secret manager (never an inline shell assignment), run the gated test; expected one bounded OpenAI request and zero Telnyx network calls. Never include the key in shell history, logs, command output, or evidence.
- [ ] **Step 5 — Verification checkpoint:** If the gate is not explicitly approved, leave the test skipped and record no live evidence; this plan does not call OpenAI.

### Task 13: Final regression, verification, and documentation gates

**Files:**
- Modify: `README.md` only if the repository has one and only for local smoke commands/config names
- Create: `specs/002-jama-ai-assistant-smoke/evidence/automated-verification.md`
- Create: `specs/002-jama-ai-assistant-smoke/evidence/completion-checklist.md`
- Modify: `specs/002-jama-ai-assistant-smoke/plan.md` only to record verified implementation notes, never test output containing secrets

- [ ] **Step 1 — RED/coverage audit:** Run `grep`/repository review to map every Feature 002 requirement to a test and task; fail the review if any required environment variable, adapter, state, dedupe invariant, marker filter, ambiguity rule, or smoke mode lacks coverage.
- [ ] **Step 2 — Implementation:** Fill only safe command/output summaries in evidence. Document the knowledge owner/technical maintainer review and reversible update process.
- [ ] **Step 3 — GREEN:** Run `npm run typecheck && npm test && npm run test:integration && npm run test:ai`; run the live-AI command only when separately approved and gated.
- [ ] **Step 4 — Verification:** Run `git diff --check`, `git status --short`, and a scope/privacy scan. Confirm no files under `C:\work\germes` changed, no real secrets are staged, no real Telnyx/OpenAI call occurred in fake tests, Feature 001 human tests remain green, and no AI history event can reach `processChatwootOutbound`.
- [ ] **Step 5 — Checkpoint:** Save masked counts/statuses only in `specs/002-jama-ai-assistant-smoke/evidence/automated-verification.md` and complete the requirement matrix in `completion-checklist.md`.

## Verification Commands

The implementation must preserve the current commands and add only these focused commands:

```powershell
npm install yaml@2.8.1 --save-exact
npm run typecheck
npm test
npm run test:integration
npm run test:ai -- tests/integration/ai/fake-smoke.test.ts
npm run test:live-ai -- tests/integration/ai/live-openai.test.ts
npx vitest run tests/unit/ai tests/contract/ai-openai-adapter.test.ts tests/contract/chatwoot-ai-history.test.ts tests/contract/marker-aware-webhook.test.ts tests/integration/ai
```

`test:live-ai` must be opt-in and must fail closed unless all live-AI variables are present. No command in this plan invokes Telnyx live SMS. Fake smoke and local live-AI always use `OUTBOUND_MODE=fake` and a fake Telnyx dispatcher.

## Requirement Coverage Matrix

| Spec requirement | Plan coverage |
|---|---|
| All requested AI configuration variables | Task 1, `src/config/env.ts`, `tests/unit/ai/config.test.ts` |
| Fake/live OpenAI adapters | Task 3, `src/ai/openai-fake.ts`, `src/ai/openai-live.ts` |
| Fake/live AI Telnyx dispatch | Task 7, `src/ai/telnyx-dispatch.ts` |
| Repository Markdown and YAML frontmatter | Task 1 fixtures, Task 2 loader/tests |
| Deterministic event selection | Task 2, `src/ai/event-selection.ts` |
| AI response validation | Task 6, `src/ai/response-validation.ts` |
| Escalation, waiting/human state | Tasks 5–6, `src/ai/escalation.ts` |
| SQLite AI state/decision dedupe | Task 5, `src/db/store.ts` |
| One decision/history/submission per inbound identity | Tasks 5, 8, 11 |
| Chatwoot/Telnyx ambiguity | Task 8 integration tests and decision statuses |
| Marker-aware human webhook filtering | Task 10 |
| Post-inbound fan-out and direct Telnyx path | Tasks 8–10 |
| Feature 001 unchanged except narrow seams | Tasks 9–10 regression tests and scope scan |
| Tests before implementation | Every task’s RED step/checkpoint |
| Fake smoke with zero real calls | Task 11 |
| Local live-AI with real OpenAI/fake Telnyx | Task 12, opt-in gate |
| No secrets/OpenAI/Telnyx calls in this planning task | Plan scope and Task 12 gate |
| No `C:\work\germes` changes | Global constraints and Task 11/13 scope tests |

## Plan-Level Contradictions and Remaining Risks

1. **Chatwoot marker representation is a hard safety gate.** The existing human predicate accepts ordinary `outgoing` user messages, so a naive AI outgoing message could be misrouted. T000B/T007 must validate marker preservation or implement the durable history-message-ID lookup fallback before AI history creation or direct AI live dispatch. T000C/T012 provide tri-state marker filtering.
2. **The specification mentions “fake Chatwoot” in fake smoke while the current `ChatwootClient` is one interface.** The plan resolves this by extending the interface with a separate AI history writer and using an in-memory fake implementing both; it does not create a second Chatwoot deployment.
3. **`AI_PROVIDER_MODE` and `AI_LIVE_OPENAI_ENABLED` overlap.** The plan treats `AI_PROVIDER_MODE=live` as necessary but insufficient: both live flags and `OPENAI_API_KEY` are required. Any other combination uses fake/no-network behavior or fails closed for an explicitly requested live path.
4. **The current inbound claim occurs after Chatwoot lookup.** Feature 002 does not claim to repair the entire Feature 001 inbound race in this interim track. The post-inbound hook only runs after a successful `created` result; AI dedupe is independently atomic before AI side effects, and T000E/T000F define callback isolation and AI-claim concurrency.
5. **Synchronous AI adds latency after inbound creation.** This is accepted only for the smoke scope and bounded by `OPENAI_TIMEOUT_MS`; no queue, worker, retry dispatcher, or background recovery is to be introduced as an unapproved expansion.
6. **The local live-AI test necessarily makes a real OpenAI call when separately enabled.** It is skipped by default, requires an externally injected key, uses fake Telnyx and `OUTBOUND_MODE=fake`, and must never be run as part of the ordinary fake smoke or final default suite.
7. **The requested “one Telnyx submission per inbound identity” conflicts with mandatory escalation/fallback behavior if interpreted literally.** This plan resolves it as an upper bound: an eligible validated answer may produce one direct AI submission; escalated/provider-error/unsafe outcomes produce zero submissions. The tests must assert the zero-send safety rule.
8. **No implementation is performed by this plan-writing step.** No OpenAI/Telnyx calls, live Chatwoot validation, real secrets, or `C:\work\germes` access are part of this task.

## Binding reconciliation decisions

The following decisions supersede any earlier ambiguous wording in this plan:

1. **Baseline:** Feature 002 targets only the current Fastify + synchronous Node SQLite `BridgeStore` repository. It introduces no PostgreSQL, worker, queue, lease, or readiness artifact and does not claim Feature 001's future architecture.
2. **Exception:** Feature 002 is the formal, versioned exception to Feature 001's AI/automation outbound prohibition, limited to one inbound-triggered response through a separate dispatcher. Human outbound behavior and all human safety controls remain unchanged.
3. **History safety:** CHW-002-01 is a hard gate. Marker preservation must be validated before AI history/live dispatch, or the durable history-message-ID lookup fallback must be implemented. The human marker decision is tri-state: absent → normal human path; valid true → ignore; malformed/present-but-invalid → fail closed/review.
4. **Outcome policy:** Only a supported validated answer can produce one history record and one submission. Fallback/escalation/provider/validation/missing-knowledge/suppressed/human/blocked/ambiguous-history paths produce zero Telnyx submissions and never post raw/fabricated output.
5. **State/isolation:** AI claims are atomic in SQLite before AI side effects. A completed inbound remains successful even if the AI callback fails; AI outcome/failure is stored separately. Duplicate inbound delivery cannot create another AI decision.
6. **Live modes:** Fake-only interim smoke is implementable after reconciliation. Local live-AI is real OpenAI + local Chatwoot + fake Telnyx and uses protected secret injection. End-to-end live AI SMS remains blocked until the durable AI guard, sender/profile/readiness relationship, authoritative recipient, no-blind-retry/restart handling, encoding/single-segment validation, explicit allowlist, and aggregate live budget relationship are implemented and separately approved.
7. **Privacy:** New Feature 002 AI records contain no raw phones, SMS bodies, prompts, OpenAI responses, secrets, or provider raw responses. Existing Feature 001 plaintext storage remains unchanged in this interim track.

## Completion Definition

Feature 002 fake-smoke implementation is complete only when all reconciliation gates and targeted RED checkpoints precede implementation, the fake smoke proves the full fan-out with zero real provider calls, the default suite and Feature 001 tests pass unchanged apart from named seams, marker-aware tri-state filtering and the hard history gate are proven, callback failures are isolated, SQLite claims survive restart/concurrency tests, ambiguity never blind-retries, SMS encoding checks pass, privacy/scope scans pass, and evidence contains only redacted metadata and command summaries. End-to-end live AI SMS is not part of fake-smoke completion and remains blocked until the live gates above pass.

**Plan status:** Reconciled for fake-smoke implementation planning; code has not been changed by this documentation update. End-to-end live AI SMS remains blocked by the explicit live gates.
