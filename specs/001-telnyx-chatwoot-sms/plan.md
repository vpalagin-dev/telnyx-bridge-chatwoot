# Implementation Plan: Telnyx ↔ local Chatwoot SMS Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Branch**: `001-telnyx-chatwoot-sms` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-telnyx-chatwoot-sms/spec.md`

**Planning scope**: This clarification-only reconciliation applies the after-tasks review addendum to `spec.md`, this plan, and the current regenerated `tasks.md`. No implementation code or live provider action is in scope. The current `tasks.md` is reconciled and is not obsolete unless a later specification change makes it stale.

## Summary

Создать отдельный JAMA bridge, который принимает подписанные Telnyx SMS webhooks, надёжно переносит eligible inbound SMS в отдельный JAMA SMS inbox существующего локального Chatwoot `http://localhost:3001` и передаёт только авторизованные ручные исходящие действия человека в Telnyx через fixed sender. Fastify ingress выполняет только authentication, exact raw-body capture, envelope validation и durable receipt/dedupe; отдельный worker выполняет business filtering, provider side effects, durable suppression и correlation.

Outbound защищён уникальным Chatwoot message ID, атомарным `ready → submitting` one-submit guard и отключёнными SDK retries. Любой неоднозначный результат после dispatch становится `unknown_needs_review`, а не blind retry. Chatwoot-originated path проверяется только signed fixtures + fake Telnyx; единственный live Telnyx outbound выполняет operator CLI на один `TEST_RECIPIENT_NUMBER`.

**Scope reconciliation**: MVP target — существующий локальный Chatwoot, не Chatwoot Cloud. Второй Chatwoot stack не создаётся, `C:\work\germes` остаётся внешним и не изменяется, кроме обычной UI/API configuration JAMA SMS inbox. Публичный tunnel/ingress exposes only the bridge; локальный Chatwoot напрямую не публикуется.

**Verification reconciliation**: inbound и Chatwoot-originated fixture evidence обязаны содержать Chatwoot IDs. Для CLI-originated live smoke `chatwoot_account_id`, `chatwoot_inbox_id`, `chatwoot_conversation_id` и `chatwoot_message_id` явно равны `null` с applicability `not_applicable`. Live Chatwoot-originated SMS запрещён; one-time CLI smoke не является reusable send surface. Ровно одна live inbound acceptance SMS разрешена; STOP/START, duplicate, race, retry и destructive scenarios выполняются только signed fixtures/provider fakes.

**Contract reconciliation**: ingress OpenAPI валидирует generic authenticated envelopes, а не enum business scope. Authentic unsupported/irrelevant Telnyx или Chatwoot events durably received/deduped и получают `200`, после чего worker записывает `ignored`; `401/403` используются только для authentication/freshness failures, `400` — для malformed JSON/schema envelope. Operator CLI имеет protected-path `suppression-export` и metadata-only `correlation-export`; export rows не выводятся и не логируются.

**Hard implementation gate**: до начала любой user-story implementation live audit обязан подтвердить local Chatwoot account/inbox IDs, API/webhook behavior, closed `signing_profile_id`, structured evidence groups и Telnyx sender/profile/signature/event semantics. Непройденный или unresolved audit item блокирует story implementation, а `unsupported` отдельно блокирует Chatwoot outbound.

## Technical Context

**Language/Version**: Node.js 22 LTS, TypeScript 5.x в strict mode

**Primary Dependencies**: Fastify, Kysely, `pg`, Zod, Pino, Telnyx Node SDK с `maxRetries: 0`; Node `crypto` для HMAC/Ed25519/AES-256-GCM

**Storage**: PostgreSQL 16; durable webhook inbox/worker, mappings, correlation, suppression, smoke-test evidence и audit metadata

**Testing**: Vitest; Testcontainers с PostgreSQL 16; provider contract fixtures; Docker smoke environment

**Target Platform**: Linux container за public TLS ingress/reverse proxy только для bridge; bridge обращается к тому же существующему Chatwoot deployment, известному оператору как `http://localhost:3001` (при container networking MAY использоваться его internal-network alias, но не другой instance), и Chatwoot не публикуется напрямую

**Project Type**: Отдельный backend web service + background worker + operator CLI, без frontend

**Performance Goals**: Webhook signature verification и durable enqueue завершаются менее чем за 2 секунды; inbound SMS появляется в Chatwoot в пределах 60 секунд при доступных dependencies; один worker instance достаточен для первого среза, несколько instances безопасны через `SKIP LOCKED`

**Constraints**: Никаких plaintext SMS body в durable bridge records/logs; encrypted transient payload hard TTL 24 часа; fixed sender; один recipient на action; отсутствие public send endpoint; не более одного Telnyx API call на outbound action; `C:\work\germes` и existing Telegram/WhatsApp inbox configurations не изменяются

**Scale/Scope**: Только индивидуальные сообщения одного JAMA SMS inbox; исключены campaigns, scheduler, batching, pause/resume, throughput optimization, cost estimation, link tracking, analytics, attribution, CRM, A2P/10DLC automation и number purchase/provisioning

## Architecture Decisions

### Runtime boundaries

1. **Ingress process** — Fastify routes для Telnyx и Chatwoot выполняют authentication/freshness before readiness disclosure, затем exact raw-body capture rules, JSON + minimal Zod envelope validation, readiness gate, encryption и durable insert/dedupe. Invalid/missing authentication возвращает `401/403` даже при invalid readiness; только authenticated request может получить sanitized `503`. Malformed JSON/schema envelope получает `400` после применимых raw-body/authentication rules; если безопасная authentication невозможна, route fail closed без provider side effects. Business relevance не решается в route.
2. **Worker process** — PostgreSQL polling/claiming, decrypt-on-use, account/inbox/event/direction/sender/conversation business filtering, provider calls, retry classification, state projection и payload purge. Authentic irrelevant/unsupported events получают durable audit outcome `ignored` и уже ACKed route response `200`.
3. **Operator CLI** — audit/review commands и ровно один allowlisted smoke send; CLI не является общим send surface. Durable guard key derives from `feature_id=001-telnyx-chatwoot-sms`, the combined Telnyx sender/profile fingerprint, and the readiness fingerprint. It is inserted only after readiness, GSM-7 preflight and typed confirmation and prevents a second attempt in that exact scope after success, rejection, ambiguity or restart. PostgreSQL is the enforcement boundary: if the database or guard row is deleted, historical exactly-one proof is lost and another live attempt requires explicit human approval as a new exceptional scope, never an automatic retry.
4. **Readiness gate** — единственный authoritative input для runtime/CLI — внешний uncommitted JSON file at `READINESS_ARTIFACT_PATH`, validated against `contracts/readiness-artifact.schema.json`. Artifact expires no later than seven days after creation and stores a closed `signing_profile_id` (`chatwoot_hmac_sha256_v1` or `unsupported`), safe facts, keyed HMAC-SHA-256 fingerprints, and structured evidence groups `chatwoot`, `telnyx`, `ingress`, `signing`, `fingerprints`, `operator_scope`, each with `pass|fail|unresolved` plus references. Runtime selects a compiled verifier by profile ID and never interprets free-text algorithm/canonicalization fields. Deterministic probes cover local Chatwoot URL/observed version, selected profile ID, Telnyx sender fingerprint, Telnyx profile fingerprint, and public-ingress HTTPS URL/certificate fingerprint. Each probe has a hard 3-second timeout; successful results may be cached for at most 60 seconds, after which the cache is stale and cannot authorize traffic. Failure, timeout, stale cache, mismatch, missing/schema-invalid/expired artifact, any non-pass group, or `unsupported` makes readiness fail closed. `/health/ready` returns sanitized `503`; webhook routes authenticate first and return readiness `503` only to authenticated requests. Markdown evidence is supplementary only.
5. **Audit receiver** — a dedicated pre-readiness mode may accept only a controlled local Chatwoot test webhook to capture sanitized signing/header/body evidence. It has no Telnyx client, Chatwoot side-effect client, business worker, production-message processing, or normal webhook activation. Audit captures are readiness evidence only and follow the provider/audit payload purge policy.
6. **PostgreSQL** — единственная durable queue и bridge system of record; Redis/RabbitMQ не нужны для этого среза.

### Telnyx ingress

`POST /webhooks/telnyx` сначала проверяет `telnyx-signature-ed25519` над `${timestamp}|${rawBody}` и `telnyx-timestamp` с допуском ±300 секунд. Invalid/missing signature возвращает `401/403` независимо от readiness. Только после successful authentication route применяет readiness gate (sanitized `503` при not-ready), парсит JSON/minimal envelope (`400` для malformed authenticated request), дедуплицирует по стабильному event identity, шифрует raw payload и отвечает `200` после durable commit.

После durable receipt worker применяет scope filter. `message.received` eligible только при `direction=inbound`, `type=SMS`, ровно одном relevant `to.phone_number == TELNYX_SENDER_NUMBER` и совпадающем profile ID, когда поле присутствует. `message.sent/finalized` eligible только при `direction=outbound` и известном `payload.id`, уже связанном с `outbound_send`. Валидно подписанные unsupported event types, MMS, wrong number/profile/direction и unknown outbound message ID durably audited/deduplicated как `ignored` и не создают Chatwoot/provider side effects; они не получают `4xx`.

`data.payload.id` связывает lifecycle events с Telnyx message. Status events могут приходить out of order; projection использует `occurred_at` и terminal-state precedence.

### Chatwoot ingress

`POST /webhooks/chatwoot` активируется только после live audit и contract finalization, которые выбрали closed `signing_profile_id`. MVP поддерживает только compiled profile `chatwoot_hmac_sha256_v1`; `unsupported` блокирует Chatwoot-originated implementation и endpoint. Runtime выбирает verifier по ID и не строит его из readiness free text. Bearer-only, IP allowlist и unsigned delivery не являются допустимым fallback.

Route сначала пытается проверить подпись exact raw body статически выбранным profile verifier. Invalid/missing authentication возвращает `401/403` независимо от readiness. После successful authentication route проверяет current readiness; invalid readiness возвращает sanitized `503`, затем minimal envelope failure возвращает `400`, а valid event durably сохраняется/deduplicates и ACKed `200` после commit. Если profile/artifact отсутствует настолько, что request нельзя безопасно аутентифицировать, route fail closed без readiness disclosure и provider side effects. Валидная подпись webhook от configured local JAMA SMS inbox является достаточным Chatwoot authorization evidence для MVP; отдельный permission lookup не выполняется. После durable receipt worker применяет строгий predicate: configured account/inbox, observed human-outbound event, `outgoing`, `private=false`, human `sender.type=user`, text-only, valid conversation binding, без campaign/automation markers. AgentBot, Captain, private notes, templates, campaigns, automation и другие authentic irrelevant events durably записываются как `ignored` без Telnyx side effect.

### Inbound SMS flow

1. Worker normalizes sender to E.164, computes lookup HMAC и atomically resolves/creates encrypted `phone_identity` plus its explicit `suppression_current` row.
2. Worker acquires the shared per-phone lock used by suppression and outbound. Pending consent events for that phone are projected before any later outbound claim.
3. Durable STOP-family detection выполняется до Chatwoot side effects.
4. `inbound_message` record durably links Telnyx event/message IDs to the processing boundary and later Chatwoot IDs.
5. Bridge resolves/creates Chatwoot Contact + ContactInbox `source_id`, then exactly one conversation. Every create first claims a globally unique durable `chatwoot_side_effect.resource_scope_key` (`contact/contact_inbox/conversation` keyed by phone+account/inbox; message keyed by Telnyx message ID) and commits `ready → submitting` before I/O. Transaction lock release therefore cannot permit a second inbound owner: a conflict reuses `completed`, waits/defers on `submitting`, or requires review on `unknown_needs_review`. Ambiguous create is reconciled by stable identifier/relationship and never blind-retried; zero or multiple candidates require review. API inbox `lock_to_single_conversation=true` is optional defense, not the primary guard.
6. Before Chatwoot message-create, `inbound_message` and its side-effect ledger commit the dispatch boundary. Safe failures proven before dispatch may retry; timeout/ambiguous response after dispatch becomes `unknown_needs_review`, because Chatwoot documents no idempotency key.
7. A successful response stores Chatwoot contact/conversation/message IDs and completes the FR-011 correlation chain. Duplicate Telnyx events return that stored outcome without another create call.
8. После terminal/manual-review projection encrypted payload purged, а IDs/hash/outcome остаются.

### Outbound SMS flow and one-submit guard

Authoritative recipient is never taken from free-form webhook phone fields. The bridge resolves configured account/inbox/conversation through `conversation_binding → chatwoot_contact_binding → phone_identity`, decrypts that identity only for dispatch, and optionally compares the webhook contact phone as a consistency assertion. Missing binding, wrong account/inbox, merged/stale contact mismatch, multiple candidates or failed reconciliation blocks the action as `recipient_mapping_needs_review` with zero Telnyx calls.

1. Durable inbox dedupe создаёт `outbound_send` с unique `chatwoot_message_id`.
2. Worker validates target, content, fixed sender/profile assignment и suppression.
3. В транзакции record lock и переход `ready → submitting`, `submission_count=1`, commit.
4. Telnyx SDK, сконфигурированный `maxRetries: 0`, делает ровно один `POST /v2/messages` с fixed `from`, одним `to`, `text`, `type=SMS`, `use_profile_webhooks=true`.
5. 2xx + message ID → `accepted`; explicit rejection → terminal для этого action; timeout/reset/ambiguous 429/5xx/process death → `unknown_needs_review`.
6. Stale `submitting` не re-dispatch: recovery переводит его в `unknown_needs_review`.
7. Telnyx status webhooks обновляют record и Chatwoot API Channel message status.

Для fixed phone sender `messaging_profile_id` не используется как selector в request. До send current number-to-profile verification обязателен и mismatch блокирует dispatch. Если после уже принятого request Telnyx возвращает valid message ID с неожиданным profile ID, factual state остаётся `accepted`; отдельно ставится critical `configuration_mismatch_after_submission`/manual-review flag. Такой incident не разрешает retry или replacement и продолжает принимать status webhooks по returned message ID.

### Suppression

Bridge хранит append-only suppression evidence и обязательную current projection row для каждого `phone_identity`; состояние создаётся атомарно вместе с phone identity, поэтому «отсутствующая строка означает clear» запрещено. `STOP`, `STOPALL`, `STOP ALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` активируют suppression. Telnyx profile block остаётся defense in depth.

Suppression update, contact/conversation resolution и outbound claim используют один и тот же per-phone transaction/advisory lock. Worker выбирает действия для одного phone последовательно по provider/action occurrence time и durable receipt order: уже durably received STOP должен быть projected до более позднего outbound claim. Это исключает first-suppression и STOP-vs-send races.

`START`/`UNSTOP` создаёт `opt_in_claimed_needs_review`, но не снимает suppression. Подтверждённый opt-in и любой clearing command полностью out of scope этого среза; current state остаётся blocked до отдельной будущей спецификации.

### Privacy and encryption

Stored provider webhook raw payloads и audit-receiver captures хранятся AES-256-GCM ciphertext с random nonce, tag, versioned key ID и AAD, связывающим source/event/schema. Ciphertext purged immediately after terminal/manual-review/evidence projection и в любом случае не позднее 24 часов без исключений или hold mechanism в этой фиче.

CLI smoke text является memory-only input: он не записывается ни plaintext, ни encrypted и исчезает вместе с process memory. Smoke records хранят только IDs/metadata, masked number, status, timestamps, `estimated_segments`, и необратимый hash только если отдельное диагностическое обоснование записано в evidence.

Canonical phone, необходимый для send/export, хранится encrypted; lookup — по отдельному keyed HMAC; UI/log display — masked. Pino request body logging отключён на webhook routes. Audit records не содержат body, secret или full phone.

### Live-smoke text guard

One-time operator smoke принимает текст только из protected `SMOKE_TEST_TEXT` или stdin и до confirmation/scope insertion выполняет non-configurable GSM-7 validation. Реализация использует полный GSM 03.38 default alphabet и extension table: default characters стоят один septet, extension characters (`^`, `{`, `}`, `\\`, `[`, `~`, `]`, `|`, `€`, form feed) — два; любой emoji, UCS-2/non-GSM character, более 160 septets или estimated segment count не равный `1` приводит к exit code `2`, zero `smoke_test_run` rows и zero Telnyx calls. Raw JavaScript string length не используется как guard. После typed confirmation CLI acquires the global smoke lock and shared per-phone suppression lock, revalidates the artifact digest/profile/suppression under the final claim boundary, and atomically inserts `smoke_test_run`, creates `outbound_send` directly in `submitting`, sets `submission_count=1`, and commits. A final blocked check inserts neither row and does not consume the allowance; after the claim commits, exactly one Telnyx call is attempted outside the transaction. Accepted smoke evidence stores only `encoding=GSM-7`, `estimated_septets` and `estimated_segments=1`, never the body.

### Metadata-only exports

Operator CLI предоставляет два защищённых export surface: suppression export и bridge correlation export. Correlation export включает только allowlisted IDs, event/action type, timestamps, status/outcome и masked identity; он не содержит SMS body, secrets, raw payload или full phone. Оба exports используют safe destination checks, не печатают и не логируют строки, и остаются доступными независимо от удаления Chatwoot contact.

## Constitution Check

*GATE: выполнен до Phase 0 и повторно проверен после Phase 1 design.*

- **I. Platform-Native First — PASS**: local Chatwoot сохраняет UI/contact/conversation responsibilities, Telnyx — SMS transport; custom bridge ограничен translation, reliability, suppression и privacy gaps. A/B/C/D matrix находится в `research.md`.
- **II. Consent and Suppression — PASS**: durable JAMA suppression автоматически проверяется до send и переживает retry/restart/merge; provider block — дополнительная защита.
- **III. Humans Initiate Outbound — PASS**: разрешены только human Chatwoot message и explicit operator CLI smoke-test; AgentBot/Captain/automation/campaign события fail closed.
- **IV. Safe Sending — PASS**: unique action identity, one-submit state machine, SDK retries disabled, fixed sender, explicit `unknown_needs_review`, authoritative environment-matched readiness and non-configurable GSM-7 one-segment guard before permanent smoke-scope consumption; campaign-only count/personalization requirements N/A, потому что campaigns отсутствуют.
- **V. Data Ownership — PASS**: metadata-only bridge correlation и suppression records exportable независимо от Chatwoot; encrypted canonical phone позволяет защищённый export, HMAC используется только для lookup.
- **VI. Evidence Before Completion — PASS**: failing tests precede implementation; committed JSON schema plus negative artifact/expiry/fingerprint tests make live audit enforceable, GSM-7 boundary tests cover the smoke guard, and quickstart defines contract, restart and limited live evidence. Throughput claims не делаются.
- **Technical Constraints — PASS**: identity/mapping рассчитаны на 20k+ contacts; scheduling отсутствует, поэтому timezone N/A; V1 out-of-scope list соблюдён.

### Post-design re-check

Все gates остаются PASS. Проект не вводит отдельный frontend, message broker, campaigns data model или autonomous outbound. Неустранимая platform limitation — отсутствие idempotency keys у provider side-effect calls — компенсируется conservative unknown/manual-review state, а не повтором.

## Project Structure

### Documentation (this feature)

```text
specs/001-telnyx-chatwoot-sms/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── bridge-ingress.openapi.yaml
    ├── readiness-artifact.schema.json
    ├── readiness-fingerprints.md
    ├── provider-mapping.md
    └── operator-cli.md
```

Текущий `tasks.md` reconciled с FR-035–FR-042 и after-tasks review addendum, включая closed signing profile, safe audit receiver, authentication precedence, deterministic probe timeout/cache TTL, structured evidence, contract finalization, scoped database guard и memory-only CLI payload. Повторный `/speckit-tasks` не требуется, пока последующее изменение спецификации снова не сделает decomposition устаревшей.

### Proposed source code layout

```text
src/
├── app.ts                         # Fastify composition only
├── server.ts                      # HTTP process entrypoint
├── worker.ts                      # Durable worker entrypoint
├── config/
│   ├── env.ts                     # Zod environment schema
│   ├── readiness.ts               # authoritative artifact schema/loader/gate
│   ├── readiness-fingerprint.ts   # keyed canonical environment fingerprints
│   └── constants.ts               # fixed event/state constants
├── http/
│   ├── raw-body.ts                # exact raw payload capture
│   ├── health-routes.ts
│   ├── telnyx-webhook-route.ts
│   └── chatwoot-webhook-route.ts
├── security/
│   ├── telnyx-signature.ts
│   ├── chatwoot-signature.ts
│   ├── payload-crypto.ts
│   ├── phone-crypto.ts
│   └── redaction.ts
├── db/
│   ├── database.ts
│   ├── types.ts
│   └── migrations/
├── inbox/
│   ├── inbox-repository.ts
│   ├── lease-repository.ts
│   └── dispatcher.ts
├── chatwoot/
│   ├── schemas.ts
│   ├── client.ts
│   ├── contact-mapping.ts
│   └── conversation-mapping.ts
├── telnyx/
│   ├── schemas.ts
│   ├── client.ts
│   └── status-mapping.ts
├── inbound/
│   └── process-inbound.ts
├── outbound/
│   ├── process-outbound.ts
│   ├── send-state-machine.ts
│   └── gsm7.ts                    # exact alphabet/septet/segment estimator
├── suppression/
│   ├── keywords.ts
│   ├── repository.ts
│   └── service.ts
├── audit/
│   └── audit-repository.ts
├── cli/
│   ├── index.ts
│   ├── smoke-send.ts
│   ├── review-unknown.ts
│   ├── suppression-export.ts
│   └── correlation-export.ts
└── observability/
    └── logger.ts

tests/
├── unit/
├── contract/
├── integration/
│   └── postgres/
└── fixtures/
    ├── chatwoot/
    └── telnyx/

Dockerfile
docker-compose.yml
package.json
tsconfig.json
vitest.config.ts
```

**Structure Decision**: Один focused service repository без frontend и внешнего queue. HTTP, worker и CLI используют общие domain/repository modules, но имеют разные entrypoints. Provider adapters изолированы от state machines; это позволяет contract tests без live sends.

## Configuration Contract

Secrets and identifiers are injected externally and never committed:

- `DATABASE_URL`
- `CHATWOOT_BASE_URL` (MVP value `http://localhost:3001` or its internal-network equivalent), `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID`, `CHATWOOT_INBOX_IDENTIFIER`
- `CHATWOOT_PAT`, `CHATWOOT_WEBHOOK_SECRET`
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_SENDER_NUMBER`, `TELNYX_MESSAGING_PROFILE_ID`
- `WEBHOOK_PAYLOAD_KEY_ID`, `WEBHOOK_PAYLOAD_KEY`, `PHONE_ENCRYPTION_KEY_ID`, `PHONE_ENCRYPTION_KEY`, `PHONE_LOOKUP_HMAC_KEY`
- `READINESS_ARTIFACT_PATH`, `READINESS_FINGERPRINT_KEY`, `PUBLIC_INGRESS_ORIGIN`, `PUBLIC_INGRESS_CERT_SPKI_SHA256`
- `TEST_RECIPIENT_NUMBER`, `SMOKE_TEST_TEXT`

Startup validates formats but does not log values. The readiness artifact is external/uncommitted and validated against `contracts/readiness-artifact.schema.json`; its `expires_at` MUST be no more than seven days after `created_at`. It stores only `signing_profile_id=chatwoot_hmac_sha256_v1|unsupported`, never arbitrary runtime-interpreted algorithm/canonicalization fields, and structured `evidence.chatwoot|telnyx|ingress|signing|fingerprints|operator_scope`, each with status and references. Fingerprints use exact fixed-order UTF-8 canonical inputs, runtime sources and test vectors in `contracts/readiness-fingerprints.md`, keyed with HMAC-SHA-256. Deterministic current-environment probes have a 3-second timeout per probe and a maximum 60-second successful-result cache TTL; timeout, failure, stale cache or mismatch is not-ready. `/health/ready` and every live dispatch require schema/time/status/groups/profile/fingerprint success. Webhook routes first authenticate raw bytes, returning `401/403` for invalid/missing auth even when not ready; only authenticated requests may receive sanitized readiness `503`. Markdown evidence, database rows or config presence alone cannot make runtime ready.

## Verification Strategy

1. Unit tests: normalization, keyword handling, signatures, timestamp windows, redaction, state transition legality.
2. Contract tests: signed provider fixtures plus tampered, stale, duplicate, unsupported, irrelevant, out-of-order and missing-field variants.
3. PostgreSQL Testcontainers: dedupe constraints, `SKIP LOCKED`, lease recovery, one-submit crash boundary, suppression restart durability, ciphertext purge.
4. HTTP integration: authentication precedes readiness disclosure; invalid/missing authentication returns `401/403` even with invalid readiness and without insert; authenticated not-ready returns sanitized `503`; authenticated malformed JSON/envelope returns `400`; authentic unsupported/irrelevant event returns `200` with one durable unclassified receipt and no route-side business decision; worker later projects durable `ignored`; duplicate delivery returns `200` with one receipt.
5. Provider fakes: Chatwoot-originated outbound uses signed fixtures + fake Telnyx only; no second Telnyx call after ambiguous result; no second Chatwoot create after ambiguous inbound result.
6. Live audit hard gate: safe audit-receiver evidence selects `chatwoot_hmac_sha256_v1` or `unsupported`; exact `http://localhost:3001` account/inbox/API/PAT behavior and Telnyx sender/profile/public-key capabilities must pass before story implementation. Audit receiver isolation proves zero provider/Chatwoot side effects, zero worker execution, and no production-message handling.
7. Readiness artifact tests: closed profile enum, rejection of arbitrary algorithm/canonicalization fields, all six structured evidence groups/status/references, missing/malformed/expired/non-pass artifacts, 3-second probe timeout, 60-second cache expiry/staleness, every required probe mismatch, and Markdown-only evidence. All failure paths are not-ready; webhook response is `503` only after valid authentication.
8. GSM-7 tests: default alphabet boundaries at 160 septets, extension-table characters counted as two, 161 septets/multi-segment text, emoji and all non-GSM/UCS-2 input rejected before confirmation, scope consumption or Telnyx.
9. Evidence: one live inbound with required Chatwoot IDs; contract-finalized fixture-based Chatwoot outbound with required Chatwoot IDs; exactly one CLI live outbound scoped by feature + sender/profile fingerprint + readiness fingerprint, whose Chatwoot IDs are `null`/not applicable and whose persisted metadata excludes message text. Database/guard loss requires documented explicit human approval for any new exceptional scope.
10. Export tests: protected metadata-only suppression and correlation exports, safe destinations, no stdout/logged rows.
11. Static regression evidence: no file changes under `C:\work\germes`, no configuration changes to existing Telegram/WhatsApp inboxes, and scope-regression scan; no runtime Telegram/WhatsApp tests.

## Implementation Readiness Gates

Before any user-story implementation starts, live audit MUST produce an external JSON artifact at `READINESS_ARTIFACT_PATH` that validates against `contracts/readiness-artifact.schema.json`. `evidence/readiness-audit.md` MAY explain the audit and link evidence, but is never authoritative. The artifact must be `status=pass`, unexpired, no more than seven days old, use a closed signing profile, contain all six passing evidence groups, and match fingerprints recomputed from deterministic current-environment probes. Any `fail`/`unresolved`, timeout, stale cache, or mismatch blocks story tasks and requires re-audit.

Required facts:

- existing local Chatwoot URL `http://localhost:3001`, observed installed version, account ID, JAMA SMS inbox ID/identifier and dedicated PAT behavior;
- selected `signing_profile_id`: `chatwoot_hmac_sha256_v1` only if confirmed by the isolated audit receiver, otherwise `unsupported`; no arbitrary signing fields are runtime input;
- confirmation that a valid selected-profile signature from that configured account/inbox is the MVP authorization evidence and no separate permission lookup is required;
- Telnyx sender assignment to exact messaging profile, compliance status, webhook endpoints, Ed25519 verification and observed event sequence/status values;
- secret-safe keyed fingerprints for Telnyx sender, Telnyx profile, readiness scope, and bridge-only public ingress URL/certificate;
- structured evidence groups `chatwoot`, `telnyx`, `ingress`, `signing`, `fingerprints`, `operator_scope`, each with status and references;
- deterministic probe policy: 3-second hard timeout per probe and 60-second maximum cache TTL, with stale cache fail-closed;
- public ingress targets only the bridge and does not expose local Chatwoot;
- only one protected `TEST_RECIPIENT_NUMBER` and no source-controlled copy;
- SDK retry policy requirement (`maxRetries: 0`) recorded for later contract verification;
- operator reconciliation procedure for `unknown_needs_review`;
- static baseline proving no file changes under `C:\work\germes` and no existing Telegram/WhatsApp inbox configuration changes.

Before US2 implementation, contract finalization records the selected profile and validates OpenAPI plus fixtures against its compiled verifier; `unsupported` is a hard stop. Runtime re-checks the artifact at startup and before each webhook acceptance/live dispatch. Webhook authentication occurs first; authenticated expiry/drift produces sanitized `503` with zero side effects, while invalid/missing authentication remains `401/403`.

## Complexity Tracking

No constitutional violations require justification. PostgreSQL as both store and queue is the simpler design for this scope; adding a broker would increase operational complexity without increasing correctness.
