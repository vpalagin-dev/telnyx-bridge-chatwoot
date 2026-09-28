# Tasks: Telnyx ↔ local Chatwoot SMS Bridge

**Input**: Design documents from `specs/001-telnyx-chatwoot-sms/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Tests are mandatory under Constitution Principle VI. Each RED checkpoint must be recorded before the implementation tasks it gates. Each implementation increment has an explicit targeted GREEN command, and final verification reruns the complete suite.

**Organization**: Tasks are grouped into shared setup/foundation and the three user stories. User-story implementation is blocked until the live audit and authoritative JSON readiness artifact gate pass.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel because it changes different files and has no dependency on another incomplete task in the same phase.
- **[US1]**, **[US2]**, **[US3]**: Maps the task to a user story from `spec.md`.
- Every task names the exact file or files it creates or modifies.
- Commands shown in RED/GREEN/checkpoint tasks are the required targeted commands unless implementation changes only a path-neutral script name while preserving the same test selection and safety semantics.

## Non-Negotiable Scope and Safety Rules

- Use only the existing local Chatwoot at `http://localhost:3001` or a verified internal alias to that same instance. Chatwoot Cloud is out of scope.
- Do not create a second Chatwoot stack, account, service, container, fork, or migration. `docker-compose.yml` may contain only bridge-owned services and PostgreSQL.
- Do not modify files under `C:\work\germes`. The only permitted interaction is normal Chatwoot UI/API configuration of the dedicated JAMA SMS inbox in the existing deployment.
- Public ingress exposes only the Node.js bridge. Local Chatwoot must remain private and must not be an ingress target.
- The external, uncommitted JSON file at `READINESS_ARTIFACT_PATH` is the sole authoritative runtime/CLI readiness input. It stores a closed `signing_profile_id` (`chatwoot_hmac_sha256_v1|unsupported`) and six structured evidence groups; Markdown evidence is supplementary only.
- Invalid/missing webhook authentication returns `401/403` before readiness disclosure. Only authenticated requests may receive sanitized readiness `503`; malformed authenticated JSON/envelopes receive `400` under route-specific raw-body rules. All fail-closed paths create zero provider side effects.
- Missing, unreadable, malformed, schema-invalid, future-dated, over-seven-day, expired, non-pass evidence group, `unsupported`, probe failure/3-second timeout, stale probe cache over 60 seconds, or fingerprint mismatch makes readiness fail closed.
- Live-audit signing through the isolated audit receiver and select only `chatwoot_hmac_sha256_v1` when confirmed; otherwise select `unsupported` and stop Chatwoot outbound. Runtime must select a compiled verifier by ID, never interpret free-text algorithm/canonicalization. Do not substitute bearer-only authentication, IP allowlisting, or unsigned webhooks.
- Audit receiver mode accepts only a controlled local Chatwoot test webhook, captures sanitized evidence, runs no business worker, calls neither Telnyx nor Chatwoot side-effect APIs, and processes no production messages.
- Chatwoot-originated outbound is verified only with profile-validated signed fixtures and fake Telnyx. Live Chatwoot-originated SMS is prohibited.
- The only live outbound is one operator CLI attempt to the external allowlisted `TEST_RECIPIENT_NUMBER`, guarded in PostgreSQL by feature ID + Telnyx sender/profile fingerprint + readiness fingerprint. Database/guard deletion destroys historical proof; any later attempt requires explicit human approval as a new exceptional scope.
- The live CLI text must be non-empty GSM-7/ASCII-compatible text, at most 160 GSM-7 septets, exactly one estimated segment, and memory-only. Reject invalid text before confirmation/guard insertion/Telnyx and never persist it, including encrypted.
- Do not persist or log plaintext SMS bodies, CLI smoke text, full phone numbers, credentials, signing secrets, encryption keys, readiness fingerprint keys, raw provider responses, or export rows. Payload purge applies to stored provider webhook payloads and audit captures.
- Do not add campaigns, audience selection, scheduler, batching, broadcast/public send endpoints, arbitrary-recipient send surfaces, pause/resume, throughput optimization, cost estimation, AI/automation outbound, link tracking, analytics, attribution, CRM, A2P/10DLC automation, number purchase, or provisioning.
- Existing Telegram and WhatsApp inboxes remain unchanged. Required regression evidence is static only; runtime Telegram/WhatsApp tests are out of scope.
- Record each operational/evidence step as **native**, **configuration**, or **custom**, with evidence reference and reason custom code is necessary, in `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md`.

---

## Phase 1: Setup and Test Harness

**Purpose**: Create the isolated bridge project and test commands without implementing any user-story behavior or touching the external Chatwoot codebase.

- [ ] T001 Create the Node.js 22/TypeScript manifest with pinned dependencies and scripts `typecheck`, `test`, `test:integration`, `test:contract`, `db:migrate`, `dev:http`, `dev:worker`, and `operator` in `package.json`
- [ ] T002 [P] Configure strict TypeScript compilation and Node.js output in `tsconfig.json`
- [ ] T003 [P] Configure Vitest unit, contract, and PostgreSQL Testcontainers projects in `vitest.config.ts`
- [ ] T004 [P] Configure ESLint and Prettier, including rules that prohibit accidental body/secret logging, in `eslint.config.js` and `.prettierrc.json`
- [ ] T005 Create bridge-only build/runtime definitions with PostgreSQL 16 and no Chatwoot service in `Dockerfile` and `docker-compose.yml`
- [ ] T006 Update `.gitignore` to exclude local environment files, `READINESS_ARTIFACT_PATH` artifacts, operator reports, protected exports, coverage, build output, and decrypted data while retaining safe redacted fixtures
- [ ] T007 Create evidence scaffolds with headings for RED/GREEN commands, native/configuration/custom classification, readiness audit, lifecycle audit, local runtime, and completion in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`, `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md`, `specs/001-telnyx-chatwoot-sms/evidence/readiness-audit.md`, `specs/001-telnyx-chatwoot-sms/evidence/lifecycle-audit.md`, `specs/001-telnyx-chatwoot-sms/evidence/local-runtime.md`, and `specs/001-telnyx-chatwoot-sms/evidence/completion-checklist.md`
- [ ] T008 Run `npm ci && npm run typecheck` to verify the scaffold, record sanitized output in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`, then checkpoint with `git add package.json package-lock.json tsconfig.json vitest.config.ts eslint.config.js .prettierrc.json Dockerfile docker-compose.yml .gitignore specs/001-telnyx-chatwoot-sms/evidence && git commit -m "chore: scaffold sms bridge and evidence harness"`

**Checkpoint**: The repository contains only bridge-owned scaffolding, PostgreSQL, and evidence/test infrastructure; no Chatwoot stack or send surface exists.

---

## Phase 2: Live Audit and Authoritative Readiness Foundation

**Purpose**: Audit the actual local/provider contracts, produce the sole authoritative machine-readable readiness input, and implement fail-closed readiness enforcement before any user-story implementation.

**⚠️ HARD GATE**: T009-T013 must produce a current `status=pass` JSON artifact whose `signing_profile_id=chatwoot_hmac_sha256_v1` and whose six required evidence groups pass. `unsupported`, any unresolved group, probe failure/timeout/stale cache, or mismatch stops Chatwoot outbound before T064A/T065. Bearer-only, IP allowlist, unsigned fallback, and runtime interpretation of free-text signing fields are forbidden.

### Live audit and authoritative artifact

- [ ] T009 Using only normal UI/API operations against the existing `http://localhost:3001`, create or confirm the dedicated JAMA SMS API inbox and record observed version, account/inbox IDs, identifier, API routes, PAT behavior, one-conversation/reopen behavior, agents, and zero changes to existing Telegram/WhatsApp inboxes in `specs/001-telnyx-chatwoot-sms/evidence/readiness-audit.md`
- [ ] T009A Add isolation tests for dedicated audit-receiver mode proving it accepts only a controlled local Chatwoot test webhook, captures sanitized evidence, starts no business worker, has no Telnyx/Chatwoot side-effect client, rejects production mode/messages, and purges stored capture under the payload policy in `tests/contract/chatwoot-audit-receiver.test.ts`
- [ ] T009B Implement and run the minimal dedicated audit-receiver mode for the controlled local test only in `src/audit-receiver.ts`; record sanitized output for readiness evidence and verify the T009A isolation tests before using it
- [ ] T010 Live-audit local Chatwoot delivery through the isolated receiver, capture sanitized headers/raw-byte evidence, and select exactly one closed profile: `chatwoot_hmac_sha256_v1` only if the complete v1 contract is confirmed, otherwise `unsupported`; do not place arbitrary algorithm/canonicalization text in runtime readiness fields or create an implicit fallback
- [ ] T011 Audit Telnyx sender/profile binding, Ed25519 public-key verification, event IDs/types/retry/status semantics, send restrictions, STOP-family behavior, compliance facts, and the mandatory `maxRetries: 0` policy without performing a live outbound in `specs/001-telnyx-chatwoot-sms/evidence/readiness-audit.md`
- [ ] T012 Audit the approved external HTTPS URL/certificate and verify that it routes only to the Node.js bridge while `http://localhost:3001` remains private; record safe ingress facts and the no-touch baseline for `C:\work\germes` in `specs/001-telnyx-chatwoot-sms/evidence/readiness-audit.md`
- [ ] T013 Generate the external uncommitted JSON artifact at `READINESS_ARTIFACT_PATH` with schema version, timestamps, maximum seven-day lifetime, `status`, Chatwoot URL/observed version, closed `signing_profile_id`, Telnyx sender/profile fingerprints, ingress URL/certificate fingerprint, readiness fingerprint, and `evidence.chatwoot|telnyx|ingress|signing|fingerprints|operator_scope`, each with `pass|fail|unresolved` plus references; validate it and record only sanitized digest/result
- [ ] T014 Update `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md` with per-step A/B/C classification for T009-T013, explicitly distinguishing native Chatwoot/Telnyx capabilities, normal configuration, isolated audit receiver, and the custom bridge/readiness gate

### Readiness RED tests

- [ ] T015 [P] Add failing artifact parser/schema tests for missing/unreadable/malformed input, unknown fields, wrong schema version, rejection of arbitrary signing algorithm/canonicalization fields, closed `signing_profile_id` enum, `unsupported`, and all six required structured evidence groups with status/references in `tests/unit/config/readiness.test.ts`
- [ ] T016 [P] Add failing time-window tests for future `created_at`, `expires_at <= created_at`, lifetime over seven days, exact boundary, expiry while the process is running, and clock-skew handling in `tests/unit/config/readiness-expiry.test.ts`
- [ ] T017 [P] Add failing canonicalization/fingerprint tests using every deterministic vector in `contracts/readiness-fingerprints.md`, CR/LF/NUL rejection, URL/E.164/UUID/SPKI normalization, constant-time comparison, readiness-scope fingerprint, and Chatwoot secret rotation mismatch in `tests/unit/config/readiness-fingerprint.test.ts`
- [ ] T018 [P] Add failing deterministic probe tests for local Chatwoot URL/observed version, selected profile ID, Telnyx sender fingerprint, Telnyx profile fingerprint, ingress HTTPS URL/certificate fingerprint, hard 3-second timeout, successful-result cache TTL of 60 seconds, stale-cache rejection, failure/mismatch, and re-audit classification in `tests/integration/readiness/current-environment.test.ts`
- [ ] T019 [P] Add failing sanitized precedence tests proving invalid/missing authentication returns `401/403` even when readiness is invalid, authenticated not-ready returns `503`, authenticated malformed envelope returns `400`, unsafe-to-authenticate input fails closed, all such paths create zero `webhook_inbox` rows/provider calls, and no diagnostic exposes URLs, IDs, fingerprints, or secrets in `tests/contract/readiness-fail-closed.test.ts`
- [ ] T020 Add a failing Markdown-non-authority test proving that complete/pass Markdown evidence without a valid current JSON artifact never makes runtime or CLI ready in `tests/contract/readiness-authority.test.ts`
- [ ] T021 **RED checkpoint**: run `npx vitest run tests/unit/config/readiness.test.ts tests/unit/config/readiness-expiry.test.ts tests/unit/config/readiness-fingerprint.test.ts tests/integration/readiness/current-environment.test.ts tests/contract/readiness-fail-closed.test.ts tests/contract/readiness-authority.test.ts`, verify failures are due only to missing readiness implementation, and append sanitized command/output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`

### Readiness implementation and targeted GREEN

- [ ] T022 Implement the Zod environment contract and fixed safety constants, including local Chatwoot-only configuration and external artifact path, in `src/config/env.ts` and `src/config/constants.ts`
- [ ] T023 Implement exact fingerprint canonicalization, HMAC-SHA-256 generation, deterministic vectors, readiness-scope fingerprint, and constant-time comparison in `src/config/readiness-fingerprint.ts`; do not implement dynamic signing canonicalization
- [ ] T024 Implement JSON loading, schema validation, closed profile dispatch metadata, six evidence-group checks, time/status checks, sanitized reason taxonomy, artifact/readiness digest, and explicit re-audit result in `src/config/readiness.ts`
- [ ] T025 Implement deterministic current-environment probes for Chatwoot URL/observed version/profile ID, Telnyx sender/profile fingerprints, and ingress HTTPS URL/certificate fingerprint with a hard 3-second timeout and maximum 60-second successful cache TTL in `src/config/readiness-probes.ts`
- [ ] T026 Wire fail-closed readiness into sanitized `/health/ready`, post-authentication webhook gates, and pre-dispatch checks in `src/http/health-routes.ts` and `src/config/readiness.ts`; Markdown/database state must not make readiness pass, and unauthenticated requests must not receive readiness disclosure
- [ ] T027 **GREEN checkpoint**: run `npm run typecheck && npx vitest run tests/unit/config/readiness.test.ts tests/unit/config/readiness-expiry.test.ts tests/unit/config/readiness-fingerprint.test.ts tests/integration/readiness/current-environment.test.ts tests/contract/readiness-fail-closed.test.ts tests/contract/readiness-authority.test.ts`, record sanitized passing output in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`, and record every tested re-audit trigger in `specs/001-telnyx-chatwoot-sms/evidence/readiness-audit.md`
- [ ] T028 Checkpoint with `git add src/config src/http/health-routes.ts tests/unit/config tests/integration/readiness tests/contract/readiness-*.test.ts specs/001-telnyx-chatwoot-sms/evidence && git commit -m "feat: enforce authoritative readiness artifact"`

**Checkpoint**: A valid, current, environment-matched JSON artifact is the only way runtime can become ready; all invalid states fail closed and demand re-audit.

---

## Phase 3: Shared Durable, Security, and Audit Foundation

**Purpose**: Build the encrypted durable inbox, database state machines, privacy controls, lifecycle audit model, and HTTP/worker composition shared by all stories.

### Foundation RED tests

- [ ] T029 [P] Add failing configuration tests for fixed sender/profile, 24-hour payload TTL, disabled Telnyx retries, no public send route, and secret-safe errors in `tests/unit/config/env.test.ts`
- [ ] T030 [P] Add failing AES-256-GCM payload/phone encryption, key ID/AAD, tamper rejection, lookup HMAC, E.164 normalization/masking, and constant-time tests in `tests/unit/security/payload-crypto.test.ts`, `tests/unit/security/phone-crypto.test.ts`, and `tests/unit/security/redaction.test.ts`
- [ ] T031 [P] Add failing PostgreSQL schema tests for every table, foreign key, state check, unique dedupe key, Chatwoot side-effect scope, one-submit constraint, smoke scope, readiness audit metadata allowance, and migration rollback in `tests/integration/postgres/schema.test.ts`
- [ ] T032 [P] Add failing durable inbox/lease tests for atomic enqueue/dedupe, `FOR UPDATE SKIP LOCKED`, bounded pre-dispatch retry, safe lease recovery, post-dispatch stale recovery to `unknown_needs_review`, immediate terminal purge, and hard 24-hour purge in `tests/integration/postgres/inbox-repository.test.ts` and `tests/integration/postgres/lease-repository.test.ts`
- [ ] T033 [P] Add failing logger/audit privacy tests proving bodies, plaintext content, full phones, tokens, authorization headers, keys, raw responses, fingerprints, and export rows cannot be emitted in `tests/unit/observability/logger.test.ts` and `tests/integration/postgres/audit-repository.test.ts`
- [ ] T034 Add failing lifecycle-audit completeness tests requiring safe events for readiness decision, receipt/authentication, durable accept/duplicate, worker filtering/ignored, suppression projection/block, side-effect claim, provider submission/response, unknown state, status projection, payload purge, export, and operator review in `tests/integration/audit/lifecycle-completeness.test.ts`
- [ ] T035 **RED checkpoint**: run `npx vitest run tests/unit/config/env.test.ts tests/unit/security tests/integration/postgres/schema.test.ts tests/integration/postgres/inbox-repository.test.ts tests/integration/postgres/lease-repository.test.ts tests/unit/observability/logger.test.ts tests/integration/postgres/audit-repository.test.ts tests/integration/audit/lifecycle-completeness.test.ts`, verify expected missing-implementation failures, and append sanitized output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`

### Foundation implementation and targeted GREEN

- [ ] T036 Implement secret-safe Pino composition, allowlisted serializers, request/body suppression on webhook routes, and redaction helpers in `src/observability/logger.ts` and `src/security/redaction.ts`
- [ ] T037 Implement payload and phone AES-256-GCM helpers, keyed phone lookup HMAC, E.164 normalization/masking, key IDs, AAD, and constant-time comparisons in `src/security/payload-crypto.ts` and `src/security/phone-crypto.ts`
- [ ] T038 Implement Kysely types, connection lifecycle, and the full initial schema from `data-model.md` in `src/db/types.ts`, `src/db/database.ts`, and `src/db/migrations/001_initial_bridge_schema.ts`
- [ ] T039 Implement durable encrypted webhook receipt/dedupe, worker claim, lease handling, pre-dispatch retry scheduling, stale post-dispatch recovery, and payload purge/TTL in `src/inbox/inbox-repository.ts` and `src/inbox/lease-repository.ts`
- [ ] T040 Implement allowlisted metadata-only audit persistence and lifecycle event names/outcomes in `src/audit/audit-repository.ts`
- [ ] T041 Implement worker dispatch composition and explicit safe-pre-dispatch, permanent, and ambiguous-post-dispatch error classes in `src/inbox/dispatcher.ts` and `src/worker.ts`
- [ ] T042 Implement Fastify composition, exact raw-body capture, liveness, readiness registration, and HTTP startup with no send endpoint in `src/http/raw-body.ts`, `src/app.ts`, and `src/server.ts`
- [ ] T043 **GREEN checkpoint — security/storage**: run `npm run typecheck && npx vitest run tests/unit/config/env.test.ts tests/unit/security tests/integration/postgres/schema.test.ts tests/integration/postgres/inbox-repository.test.ts tests/integration/postgres/lease-repository.test.ts`, and append sanitized passing output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`
- [ ] T044 **GREEN checkpoint — logging/audit/runtime**: run `npx vitest run tests/unit/observability/logger.test.ts tests/integration/postgres/audit-repository.test.ts tests/integration/audit/lifecycle-completeness.test.ts`, and append sanitized passing output plus event coverage to `specs/001-telnyx-chatwoot-sms/evidence/lifecycle-audit.md`
- [ ] T045 Update `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md` for the shared foundation, explaining why native provider facilities do not supply bridge-owned durable dedupe, suppression, correlation, privacy, and audit completeness
- [ ] T046 Checkpoint with `git add src/db src/inbox src/security src/audit src/observability src/app.ts src/server.ts src/worker.ts tests specs/001-telnyx-chatwoot-sms/evidence && git commit -m "feat: add durable secure bridge foundation"`
- [ ] T047 Re-run `npm run typecheck && npm test && npm run test:integration` as the foundation checkpoint; if any test regresses, stop before US1 and record the failure in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`

**Checkpoint**: Durable receipt, privacy, queueing, audit, and readiness enforcement pass; no provider message call is reachable.

---

## Phase 4: User Story 1 — Inbound SMS Appears in Local Chatwoot (Priority: P1) 🎯 MVP

**Goal**: Accept one signed Telnyx inbound SMS, ACK it in under two seconds after durable receipt, project suppression, map it into exactly one local Chatwoot contact/conversation, and preserve complete correlation without duplicate side effects.

**Independent Test**: Replay one signed Telnyx fixture and verify one receipt, one inbound record, one phone/suppression identity, one local Chatwoot conversation/message fake call, complete IDs, durable ignored outcomes for unrelated events, and zero duplicate calls on replay/restart.

### US1 tests and mandatory RED checkpoint

- [ ] T048 [P] [US1] Add redacted Telnyx fixtures for valid inbound, duplicate, STOP/STOPALL/STOP ALL/UNSUBSCRIBE/CANCEL/END/QUIT, START/UNSTOP, tampered/stale/future signatures, malformed envelope, MMS, wrong number/profile/direction, unsupported event, retry, and out-of-order lifecycle cases in `tests/fixtures/telnyx/`
- [ ] T049 [P] [US1] Add failing Telnyx route tests for exact raw bytes, awaited Ed25519 verification, ±300-second freshness, authentication-before-readiness (`401/403` despite invalid readiness; authenticated not-ready `503`), authenticated malformed `400`, unsafe-to-authenticate fail-closed behavior, ACK only after commit, duplicate `200`, authentic unsupported `200`, and no route-side business filtering in `tests/contract/telnyx-webhook.test.ts`
- [ ] T050 [P] [US1] Add failing ACK performance tests proving valid, duplicate, and authentic unsupported Telnyx receipts complete in less than two seconds under the production-like PostgreSQL path without waiting for worker/Chatwoot processing in `tests/performance/telnyx-ingress-ack.test.ts`
- [ ] T051 [P] [US1] Add failing phone/suppression tests for atomic clear initialization, STOP-family activation, START/UNSTOP remaining blocked, missing current row fail-closed, duplicate/retry durability, bridge/database restart durability, contact merge, repeated import, and repeated binding repoint without suppression loss in `tests/integration/suppression/durability.test.ts` and `tests/unit/suppression/keywords.test.ts`
- [ ] T052 [P] [US1] Add failing local Chatwoot client/mapping tests for stable identifiers, ContactInbox reconciliation, exactly one conversation per phone/inbox, reopen behavior, import/repoint idempotence, merge handling, zero/multiple candidate review, and sanitized errors in `tests/contract/chatwoot-inbound-client.test.ts` and `tests/integration/chatwoot/mapping.test.ts`
- [ ] T053 [US1] Add failing inbound orchestration tests for post-receipt scope filtering, durable ignored outcomes, suppression-before-side-effects, full Telnyx/bridge/Chatwoot correlation, duplicate/retry/restart reuse, safe pre-dispatch retry, post-dispatch ambiguity, no blind Chatwoot retry, and terminal payload purge in `tests/integration/inbound/process-inbound.test.ts`
- [ ] T054 [US1] Add failing concurrency/crash tests proving two first inbound messages create one contact, one ContactInbox, one conversation, and two messages, while committed `resource_scope_key` prevents a second create after process death in `tests/integration/inbound/chatwoot-side-effect-concurrency.test.ts`
- [ ] T055 [US1] **RED checkpoint before US1 implementation**: run `npx vitest run tests/contract/telnyx-webhook.test.ts tests/performance/telnyx-ingress-ack.test.ts tests/unit/suppression/keywords.test.ts tests/integration/suppression/durability.test.ts tests/contract/chatwoot-inbound-client.test.ts tests/integration/chatwoot/mapping.test.ts tests/integration/inbound`, verify failures are caused by missing US1 behavior, and append sanitized output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`; do not start T056 before this evidence exists

### US1 implementation and targeted GREEN increments

- [ ] T056 [P] [US1] Implement generic Telnyx route-envelope schemas and separate worker-only inbound/status eligibility schemas in `src/telnyx/schemas.ts`
- [ ] T057 [P] [US1] Implement awaited Telnyx Ed25519 verification over `${timestamp}|${rawBody}` with freshness, strict header handling, and safe errors in `src/security/telnyx-signature.ts`
- [ ] T058 [US1] Implement the Telnyx route with raw-body signature authentication first, readiness disclosure/gate second, authenticated generic envelope validation third, then encryption, durable receipt/dedupe, and ACK-after-commit in `src/http/telnyx-webhook-route.ts`; keep business filtering out of the route and create zero side effects for auth/readiness/malformed failures
- [ ] T059 [US1] **GREEN checkpoint — Telnyx ingress**: run `npm run typecheck && npx vitest run tests/contract/telnyx-webhook.test.ts tests/performance/telnyx-ingress-ack.test.ts` and record passing latency percentiles/max with sanitized environment facts in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`
- [ ] T060 [P] [US1] Implement STOP/START normalization, append-only evidence, mandatory current projection, per-phone lock ordering, and durable import/repoint-safe suppression in `src/suppression/keywords.ts`, `src/suppression/repository.ts`, and `src/suppression/service.ts`
- [ ] T061 [P] [US1] Implement the minimum-permission local Chatwoot API adapter, response sanitization, and reconciliation calls for contacts, ContactInboxes, conversations, incoming messages, and reopen behavior in `src/chatwoot/schemas.ts` and `src/chatwoot/client.ts`
- [ ] T062 [US1] Implement bridge-owned contact/conversation bindings and unique Chatwoot side-effect claims/reconciliation across retry, restart, merge, import, and repoint in `src/chatwoot/contact-mapping.ts` and `src/chatwoot/conversation-mapping.ts`
- [ ] T063 [US1] Implement worker-side Telnyx business filtering, durable ignored projection, inbound processing, suppression ordering, Chatwoot dispatch boundaries, correlation persistence, ambiguity handling, lifecycle audit, and payload purge in `src/inbound/process-inbound.ts` and `src/inbox/dispatcher.ts`
- [ ] T064 [US1] **GREEN/checkpoint**: run `npx vitest run tests/unit/suppression/keywords.test.ts tests/integration/suppression/durability.test.ts tests/contract/chatwoot-inbound-client.test.ts tests/integration/chatwoot/mapping.test.ts tests/integration/inbound`, update US1 A/B/C evidence in `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md`, then checkpoint with `git add src/telnyx src/security/telnyx-signature.ts src/http/telnyx-webhook-route.ts src/suppression src/chatwoot src/inbound src/inbox/dispatcher.ts tests specs/001-telnyx-chatwoot-sms/evidence && git commit -m "feat: deliver inbound sms to local chatwoot"`

**Checkpoint**: US1 passes independently with signed fixtures and provider fakes; one later live inbound acceptance is prepared but not yet executed.

---

## Phase 5: User Story 2 — Human Agent Outbound via Signed Fixture and Fake Telnyx (Priority: P1)

**Goal**: Accept only the contract-finalized `chatwoot_hmac_sha256_v1` profile from the configured local JAMA inbox, filter for a human outgoing action, and make at most one fake Telnyx submission with no live Chatwoot-originated SMS.

**Independent Test**: Replay a signed human fixture through the production-like bridge with fake Telnyx and verify required Chatwoot IDs, one provider call, suppression/recipient checks, no duplicate/restart call, lifecycle status feedback, and durable ignored outcomes.

**Blocking rule**: If T010/T013 did not select `signing_profile_id=chatwoot_hmac_sha256_v1`, US2 remains blocked. `unsupported` is a hard stop. Do not implement guessed/dynamic HMAC or any fallback.

### US2 contract finalization, tests, and mandatory RED checkpoint

- [ ] T064A [US2] Before any US2 implementation, record the selected `signing_profile_id` in `specs/001-telnyx-chatwoot-sms/contracts/provider-mapping.md`, validate `contracts/bridge-ingress.openapi.yaml` and planned Chatwoot fixtures against the compiled `chatwoot_hmac_sha256_v1` verifier contract, and record the owner/result in `evidence/readiness-audit.md`; if profile is `unsupported`, mark T065-T081 blocked
- [ ] T065 [P] [US2] Add redacted fixtures generated for the finalized `chatwoot_hmac_sha256_v1` profile for authorized human outgoing, duplicate delivery/action, incoming, private, AgentBot, Captain, template, campaign, automation, wrong account/inbox, missing safety fields, contact mismatch, tampered/stale signatures, and unsupported events in `tests/fixtures/chatwoot/`
- [ ] T066 [P] [US2] Add failing Chatwoot signature contract tests proving readiness selects only the compiled verifier by profile ID, arbitrary algorithm/canonicalization fields are rejected, and v1 covers exact headers/canonical bytes/digest/freshness, tamper/stale/replay, secret rotation mismatch, `unsupported`, and rejection of bearer-only/IP-allowlist/unsigned fallback in `tests/contract/chatwoot-signature.test.ts`
- [ ] T067 [P] [US2] Add failing Chatwoot route tests for authentication-before-readiness, exact raw bytes, profile-selected HMAC verification, invalid/missing auth `401/403` despite invalid readiness, authenticated readiness `503`, authenticated malformed `400`, unsafe-to-authenticate fail closed, delivery/event dedupe, ACK-after-commit, authentic irrelevant `200`, and no route-side business filtering in `tests/contract/chatwoot-webhook.test.ts`
- [ ] T068 [P] [US2] Add failing ACK performance tests proving valid, duplicate, and authentic irrelevant Chatwoot receipts complete in less than two seconds under the production-like PostgreSQL path without waiting for worker/Telnyx processing in `tests/performance/chatwoot-ingress-ack.test.ts`
- [ ] T069 [P] [US2] Add failing worker authorization/recipient tests proving a valid `chatwoot_hmac_sha256_v1` signature is sufficient without a permission lookup while configured account/inbox, outgoing human user, non-private text, no automation/template/campaign marker, and authoritative conversation binding are mandatory; cover merge, repoint, repeated import, stale/multiple binding, and zero Telnyx calls in `tests/integration/outbound/recipient-resolution.test.ts`
- [ ] T070 [P] [US2] Add failing one-submit tests for legal transitions, `submission_count <= 1`, `ready → submitting` commit, explicit rejection, timeout/reset/429/5xx/malformed success, stale submitting, process death, duplicate delivery, worker restart, and no re-arm in `tests/unit/outbound/send-state-machine.test.ts` and `tests/integration/outbound/one-submit.test.ts`
- [ ] T071 [P] [US2] Add failing Telnyx client contract tests for fixed `from`, one `to`, SMS-only payload, `use_profile_webhooks=true`, no dynamic profile/webhook/schedule fields, `maxRetries: 0` globally/per request, and post-acceptance profile mismatch incident handling in `tests/contract/telnyx-send-client.test.ts`
- [ ] T072 [P] [US2] Add failing suppression ordering/durability tests for already-received STOP before send, first STOP/send race, retry/restart, merge, repeated import/repoint, missing state fail-closed, and START/UNSTOP remaining blocked in `tests/integration/outbound/suppression-race.test.ts`
- [ ] T073 [P] [US2] Add failing lifecycle projection tests for known-message correlation, duplicate and out-of-order event precedence, unknown/wrong-scope ignored events, Chatwoot status updates, and complete audit chain from signed receipt through final status in `tests/integration/outbound/status-projection.test.ts`
- [ ] T074 [US2] **RED checkpoint before US2 implementation**: run `npx vitest run tests/contract/chatwoot-signature.test.ts tests/contract/chatwoot-webhook.test.ts tests/performance/chatwoot-ingress-ack.test.ts tests/integration/outbound/recipient-resolution.test.ts tests/unit/outbound/send-state-machine.test.ts tests/integration/outbound/one-submit.test.ts tests/contract/telnyx-send-client.test.ts tests/integration/outbound/suppression-race.test.ts tests/integration/outbound/status-projection.test.ts`, verify expected missing-US2 failures, and append sanitized output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`; do not start T075 before this evidence exists

### US2 implementation and targeted GREEN increments

- [ ] T075 [US2] Implement a closed verifier registry in `src/security/chatwoot-signature.ts` with only compiled `chatwoot_hmac_sha256_v1`; select by validated `signing_profile_id`, reject `unsupported` and unknown/free-text contract inputs, and expose no fallback mode
- [ ] T076 [US2] Implement the Chatwoot route with exact raw-body profile authentication first, readiness disclosure/gate second, authenticated generic envelope validation third, then encryption, durable dedupe, and ACK-after-commit in `src/http/chatwoot-webhook-route.ts`; keep business eligibility in the worker and create zero side effects for auth/readiness/malformed failures
- [ ] T077 [US2] **GREEN checkpoint — Chatwoot ingress**: run `npm run typecheck && npx vitest run tests/contract/chatwoot-signature.test.ts tests/contract/chatwoot-webhook.test.ts tests/performance/chatwoot-ingress-ack.test.ts` and record sanitized passing latency/contract evidence in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`
- [ ] T078 [P] [US2] Implement the Telnyx adapter with fixed sender, one recipient, retries disabled globally/per call, sanitized response classification, and post-acceptance profile mismatch incident handling in `src/telnyx/client.ts`
- [ ] T079 [P] [US2] Implement legal outbound state transitions and stale-submitting recovery to `unknown_needs_review` without any path back to `ready` in `src/outbound/send-state-machine.ts`
- [ ] T080 [US2] Implement strict worker filtering, authoritative recipient resolution, consent ordering, suppression guard, atomic one-submit claim, one fakeable Telnyx dispatch, outcome classification, local Chatwoot status feedback, audit events, and payload purge in `src/outbound/process-outbound.ts`, `src/telnyx/status-mapping.ts`, and `src/inbox/dispatcher.ts`
- [ ] T081 [US2] **GREEN/checkpoint**: run `npx vitest run tests/integration/outbound/recipient-resolution.test.ts tests/unit/outbound/send-state-machine.test.ts tests/integration/outbound/one-submit.test.ts tests/contract/telnyx-send-client.test.ts tests/integration/outbound/suppression-race.test.ts tests/integration/outbound/status-projection.test.ts`, update US2 A/B/C and lifecycle evidence in `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md` and `specs/001-telnyx-chatwoot-sms/evidence/lifecycle-audit.md`, then checkpoint with `git add src/security/chatwoot-signature.ts src/http/chatwoot-webhook-route.ts src/telnyx src/outbound src/inbox/dispatcher.ts tests specs/001-telnyx-chatwoot-sms/evidence && git commit -m "feat: guard human chatwoot outbound sms"`

**Checkpoint**: US2 passes only with contract-finalized `chatwoot_hmac_sha256_v1` fixtures and fake Telnyx. Live Chatwoot-originated SMS remains zero.

---

## Phase 6: User Story 3 — Restricted One-Time Operator CLI Smoke (Priority: P1)

**Goal**: Provide readiness/review/export commands and one permanently guarded live CLI submission to only `TEST_RECIPIENT_NUMBER`, with encoding-aware single-segment validation and masked evidence.

**Independent Test**: Against fakes, every invalid target/readiness/text/suppression/confirmation/scope case makes zero calls, while one valid run creates one permanent scope, one send record, and one call; restart/reinvocation cannot send again.

### US3 tests and mandatory RED checkpoint

- [ ] T082 [P] [US3] Add failing CLI parser tests allowing only `audit-readiness`, `smoke-send --confirm-one-submit`, `review-unknown --id`, `suppression-export --output`, and `correlation-export --output`, while rejecting arbitrary target/sender/profile, file/CSV/batch/campaign/schedule/retry/AI and hidden bypass options in `tests/contract/operator-cli.test.ts`
- [ ] T083 [P] [US3] Add failing GSM-7 estimator tests for the complete default/extension tables, 160 default septets accepted, 161 rejected, 80 extension characters accepted, 81 rejected, mixed boundaries, empty input, emoji, Cyrillic, UCS-2/non-GSM, surrogate pairs, and exact segment count in `tests/unit/outbound/gsm7.test.ts`
- [ ] T084 [P] [US3] Add failing smoke preflight tests for external-only target/text input, exact allowlist, E.164, authoritative artifact/probes/fingerprints, `unsupported`, suppression, sender/profile, retries zero, exact `SEND ONCE`, GSM-7 validation before confirmation/guard insertion, memory-only text with no plaintext/encrypted persistence, and zero-call exits in `tests/integration/cli/smoke-preflight.test.ts`
- [ ] T085 [US3] Add failing one-time execution tests for a guard keyed by feature ID + Telnyx sender/profile fingerprint + readiness fingerprint, advisory locks, final readiness revalidation, suppression rollback without guard consumption, one metadata-only `smoke_test_run`, one `outbound_send`, one call, consumed scope after success/rejection/ambiguity/crash/restart, no stored message text, masked report fields, and a documented fail-closed state after simulated database/guard loss that requires explicit human approval for any new exceptional scope in `tests/integration/cli/smoke-send.test.ts`
- [ ] T086 [P] [US3] Add failing unknown-review tests proving annotations are audited, never re-arm the original action, never create a send, and expose only masked metadata in `tests/integration/cli/review-unknown.test.ts`
- [ ] T087 [P] [US3] Add failing export tests for protected paths, no stdout/logged rows, allowlisted columns, suppression/correlation completeness, Chatwoot ID applicability, and export persistence after Chatwoot contact deletion, merge, repoint, and repeated import/repoint in `tests/integration/cli/suppression-export.test.ts` and `tests/integration/cli/correlation-export.test.ts`
- [ ] T088 [US3] **RED checkpoint before US3 implementation**: run `npx vitest run tests/contract/operator-cli.test.ts tests/unit/outbound/gsm7.test.ts tests/integration/cli/smoke-preflight.test.ts tests/integration/cli/smoke-send.test.ts tests/integration/cli/review-unknown.test.ts tests/integration/cli/suppression-export.test.ts tests/integration/cli/correlation-export.test.ts`, verify expected missing-US3 failures, and append sanitized output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`; do not start T089 before this evidence exists

### US3 implementation and targeted GREEN increments

- [ ] T089 [P] [US3] Implement the dependency-free GSM 03.38 default/extension estimator returning encoding, septets, and segments while rejecting every non-GSM code point in `src/outbound/gsm7.ts`
- [ ] T090 [US3] Implement the strict CLI dispatcher, allowed commands, argument schemas, forbidden-option detection, safe exit codes, and no general send surface in `src/cli/index.ts`
- [ ] T091 [P] [US3] Implement sanitized `audit-readiness` using the same authoritative artifact parser, expiry, probes, fingerprints, HMAC result, and re-audit taxonomy as runtime in `src/cli/audit-readiness.ts`
- [ ] T092 [US3] Implement smoke preflight, memory-only GSM-7 text validation, exact confirmation, database guard derived from feature ID + sender/profile fingerprint + readiness fingerprint, final revalidation transaction, suppression locking, fixed target/sender, one-call execution, metadata-only record/report, and explicit refusal to infer retry permission after database/guard loss in `src/cli/smoke-send.ts`
- [ ] T093 [P] [US3] Implement masked unknown-outcome inspection and audited non-rearming annotations in `src/cli/review-unknown.ts`
- [ ] T094 [P] [US3] Implement protected suppression and metadata-only correlation exports with safe destination checks, in-process decryption only for suppression export, allowlisted columns, deletion/repoint independence, and no stdout/logged rows in `src/cli/suppression-export.ts` and `src/cli/correlation-export.ts`
- [ ] T095 [US3] Wire operator commands to shared database/readiness/provider composition and package scripts in `src/cli/index.ts` and `package.json`
- [ ] T096 [US3] **GREEN checkpoint — GSM-7/preflight**: run `npm run typecheck && npx vitest run tests/unit/outbound/gsm7.test.ts tests/contract/operator-cli.test.ts tests/integration/cli/smoke-preflight.test.ts`, and append sanitized passing output to `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`
- [ ] T097 [US3] **GREEN checkpoint — one-time execution**: run `npx vitest run tests/integration/cli/smoke-send.test.ts tests/integration/cli/review-unknown.test.ts`, and record scope/restart/ambiguity evidence in `specs/001-telnyx-chatwoot-sms/evidence/lifecycle-audit.md`
- [ ] T098 [US3] **GREEN checkpoint — exports**: run `npx vitest run tests/integration/cli/suppression-export.test.ts tests/integration/cli/correlation-export.test.ts`, and record deletion/merge/repoint/reimport export evidence without exported rows in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`
- [ ] T099 [US3] Update US3 A/B/C evidence in `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md`, then checkpoint with `git add src/cli src/outbound/gsm7.ts package.json package-lock.json tests specs/001-telnyx-chatwoot-sms/evidence && git commit -m "feat: add guarded operator sms smoke cli"`

**Checkpoint**: US3 passes entirely against fakes. The permanent live scope remains unused until final gates pass.

---

## Phase 7: Deployment, Regression, Performance, and Evidence Gates

**Purpose**: Prove the complete vertical slice without expanding scope or exceeding the live-traffic budget.

- [ ] T100 [P] Add production-like HTTP/worker/migration container commands, bridge-only ingress assumptions, and explicit external local Chatwoot configuration with no Chatwoot container/service in `Dockerfile`, `docker-compose.yml`, and `README.md`
- [ ] T101 [P] Add a static scope-regression test that fails on Chatwoot Cloud, a second Chatwoot stack/account/service, paths or modifications under `C:\work\germes`, direct Chatwoot ingress, public send routes, arbitrary targets, campaigns, scheduler, batching, broadcast, AI/automation outbound, analytics, CRM, link tracking, attribution, A2P/10DLC automation, number purchase/provisioning, or runtime Telegram/WhatsApp tests in `tests/contract/scope-regression.test.ts`
- [ ] T102 [P] Add a privacy regression test scanning logs, audit snapshots, reports, exports metadata, and persisted rows for provider SMS plaintext, CLI smoke text in plaintext or ciphertext, full phones, credentials, forbidden headers, readiness keys/fingerprints, raw responses, and expired provider/audit-capture ciphertext in `tests/integration/security/privacy-regression.test.ts`
- [ ] T103 Add an end-to-end lifecycle audit completeness test covering readiness evidence groups/probes, authentication-before-readiness for both ingress types, accepted/duplicate/ignored/rejected receipts, suppression, inbound Chatwoot side effects, outbound one-submit, provider response/status, unknown review, provider/audit-capture purge, and export events in `tests/integration/audit/end-to-end-lifecycle.test.ts`
- [ ] T104 Run `npm run typecheck && npm test && npm run test:contract && npm run test:integration`, capture fresh passing output and the FR/SC coverage matrix in `specs/001-telnyx-chatwoot-sms/evidence/automated-verification.md`, and stop on any failure
- [ ] T105 Run production-like local HTTP/worker/migrations and verify liveness, readiness, fail-closed re-audit triggers, restart recovery, payload purge, no send endpoint, and both ingress ACK paths under two seconds; record sanitized commands/timings in `specs/001-telnyx-chatwoot-sms/evidence/local-runtime.md`
- [ ] T106 From outside the bridge process/container boundary, probe the approved HTTPS origin and prove it reaches bridge health/webhook surfaces only, has the audited certificate SPKI, exposes no Chatwoot route/UI/API, and does not make `http://localhost:3001` public; record sanitized results in `specs/001-telnyx-chatwoot-sms/evidence/external-ingress-probe.md` and classify each step in `specs/001-telnyx-chatwoot-sms/evidence/native-configuration-custom.md`
- [ ] T107 Re-run authoritative validation immediately before live evidence: require schema-valid/unexpired `pass`, `signing_profile_id=chatwoot_hmac_sha256_v1`, all six evidence groups pass, each deterministic probe completes within 3 seconds using no cache older than 60 seconds, matching Chatwoot URL/version/profile, Telnyx sender/profile, readiness, and ingress URL/certificate fingerprints, bridge-only ingress, fixed sender/profile, and unused scoped database guard; record only sanitized status/digest
- [ ] T108 Execute exactly one live inbound acceptance SMS, require appearance in the correct JAMA SMS conversation within 60 seconds, and correlate Telnyx event/message, bridge receipt/inbound, local Chatwoot account/inbox/contact/conversation/message IDs in `specs/001-telnyx-chatwoot-sms/evidence/live-inbound.md`; use fixtures for duplicate, STOP/START, retry, and destructive cases
- [ ] T109 After T064A contract finalization, replay one `chatwoot_hmac_sha256_v1` signed human fixture through the production-like bridge with fake Telnyx, require complete Chatwoot IDs, exactly one fake submission, duplicate/restart suppression, ignored-event handling, and status feedback in `specs/001-telnyx-chatwoot-sms/evidence/chatwoot-outbound-fake.md`; perform zero live Chatwoot-originated SMS
- [ ] T110 Run protected suppression and correlation exports after simulated contact deletion/merge/repoint and repeated import/repoint, verify complete bridge-owned metadata remains available with no stdout/logged rows, and record only sanitized counts/schema/results in `specs/001-telnyx-chatwoot-sms/evidence/export-durability.md`
- [ ] T111 After T104-T110 pass, execute `npm run operator -- smoke-send --confirm-one-submit` exactly once using protected `TEST_RECIPIENT_NUMBER` and memory-only GSM-7 text of at most 160 septets/one segment; consume the database guard scoped by feature + Telnyx sender/profile fingerprint + readiness fingerprint, persist no text, and save only masked metadata with all Chatwoot IDs `null`/`not_applicable`. Never retry/replace an accepted, rejected, unknown, or crashed attempt; if the database/guard is later lost, another attempt requires explicit human approval as a new exceptional scope
- [ ] T112 Complete `specs/001-telnyx-chatwoot-sms/evidence/completion-checklist.md` with FR/SC coverage, RED-before-GREEN links, native/configuration/custom evidence, lifecycle audit completeness, readiness failure matrix, HMAC contract result, `<2s` ingress evidence, suppression restart/retry/merge/import/repoint durability, export-after-deletion/repoint evidence, external bridge-only HTTPS proof, zero `C:\work\germes` file changes, zero Telegram/WhatsApp configuration changes, zero live Chatwoot-originated sends, one live inbound, one live CLI attempt, and all out-of-scope exclusions
- [ ] T113 Final checkpoint: run `git status --short`, verify no secrets/readiness artifact/protected export/phone/SMS content are staged, then checkpoint the completed implementation/evidence with a grouped commit such as `git add README.md Dockerfile docker-compose.yml tests specs/001-telnyx-chatwoot-sms/evidence && git commit -m "test: verify telnyx chatwoot sms vertical slice"`; do not commit external readiness or protected evidence files containing sensitive data

**Checkpoint**: All automated and operational gates pass, both ingress routes ACK durable receipts in under two seconds, only the bridge is public, live traffic stayed within budget, and no prohibited send surface or product scope exists.

---

## Dependencies and Execution Order

### Phase dependencies

- **Phase 1** starts immediately and creates only scaffolding/test/evidence infrastructure.
- **Phase 2** depends on Phase 1. T009-T013, including isolated audit receiver and closed profile selection, are the live-audit hard gate; T015-T028 make the artifact enforceable.
- **Phase 3** depends on the Phase 2 readiness foundation and blocks all user stories.
- **US1** depends on Phases 1-3 and its T055 RED checkpoint.
- **US2** depends on Phases 1-3, `signing_profile_id=chatwoot_hmac_sha256_v1`, T064A contract finalization, US1 binding/suppression components, and its T074 RED checkpoint.
- **US3** depends on Phases 1-3, the one-submit/suppression components, and its T088 RED checkpoint.
- **Phase 7** depends on all selected story GREEN checkpoints. The one-time live outbound T111 is last and depends on T104-T110.

### Hard-stop conditions

- `signing_profile_id=unsupported`, unknown profile, failed T064A finalization, or profile/OpenAPI/fixture mismatch: US2 and Chatwoot endpoint activation remain blocked; no fallback is permitted.
- Any missing/invalid/expired artifact, non-pass required evidence group, probe failure/3-second timeout, cache older than 60 seconds, or fingerprint mismatch: live acceptance/dispatch stop with re-audit required after authentication precedence is honored.
- Any RED checkpoint not captured before implementation: stop and restore the required test-first evidence.
- Any test/privacy/scope regression: stop before live evidence.
- Any consumed guard for the same feature + Telnyx sender/profile fingerprint + readiness fingerprint: T111 is forbidden. Database/guard loss does not reset permission; it requires explicit human approval for a new exceptional scope.

### User-story dependency graph

```text
Setup
  -> live audit + authoritative readiness parser/gate
  -> durable/security/audit foundation
  -> US1 inbound + suppression/bindings
  -> US2 signed human fixture outbound + fake Telnyx
  -> US3 guarded CLI/review/exports
  -> full verification + external HTTPS probe
  -> one live inbound
  -> fake Chatwoot outbound proof
  -> exactly one live CLI outbound
```

### Parallel opportunities

- T002-T004, T015-T020, T029-T034, T048-T052, T065-T073, T082-T087, and T100-T102 contain parallelizable file sets where marked `[P]`.
- Implementation tasks marked `[P]` may begin only after their phase's RED checkpoint and any stated hard gate.
- Tasks sharing `src/inbox/dispatcher.ts`, `src/cli/index.ts`, evidence files, or migration files remain sequential to avoid conflicting edits.

---

## Implementation Strategy

1. Finish setup and the live audit first; do not guess provider contracts.
2. Make JSON readiness and fingerprints fail closed before implementing provider flows.
3. Complete and commit the durable/privacy/audit foundation.
4. For each story: write tests, record the explicit RED checkpoint, implement in small increments, run targeted GREEN commands, update A/B/C evidence, and commit at the story boundary.
5. Use signed fixtures and provider fakes for all duplicates, STOP/START, retry, race, merge, import/repoint, deletion, ambiguity, crash, restart, and status-order tests.
6. Run full verification and the external bridge-only HTTPS probe before any live traffic.
7. Use exactly one live inbound acceptance SMS, zero live Chatwoot-originated outbound SMS, and exactly one permanently guarded CLI outbound attempt.

## Live-Traffic Budget

- Live inbound: exactly one acceptance SMS in T108.
- Live Chatwoot-originated outbound: zero.
- Live operator CLI outbound: exactly one Telnyx submission attempt in T111 after every gate passes, scoped in PostgreSQL by feature + sender/profile fingerprint + readiness fingerprint; success, rejection, ambiguity, or crash consumes that scope. Loss of the database guard destroys proof and requires explicit human approval for any new exceptional scope.
- All other scenarios: signed fixtures/provider fakes only.

## Notes

- The JSON readiness artifact is external and uncommitted; Markdown can explain evidence but cannot enable readiness.
- Route handlers authenticate, validate generic envelopes, encrypt, durably receive/dedupe, and ACK. Business filtering belongs to workers.
- Authentic unsupported/irrelevant events receive durable receipt and HTTP `200`; authentication/schema failures receive `4xx`; readiness/commit failures receive `503`.
- Unknown side-effect outcomes never authorize blind retry.
- Existing local Chatwoot, Telegram, WhatsApp, and `C:\work\germes` remain external and unchanged except normal JAMA inbox UI/API configuration.
- This file is a task plan only. `/speckit-tasks` does not implement code or execute live sends.
