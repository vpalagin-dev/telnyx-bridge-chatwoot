# Quickstart Validation Guide

Этот документ описывает будущую проверку реализации. Он не является implementation script и не разрешает live send до прохождения readiness gates.

## 1. Safety rules

- Использовать только существующий локальный Chatwoot `http://localhost:3001` и отдельный JAMA SMS API inbox, созданный/настроенный штатными UI/API operations.
- Chatwoot Cloud и второй Chatwoot stack не использовать; `C:\work\germes` не изменять.
- Не изменять Telegram/WhatsApp inboxes или их webhooks.
- Публиковать через HTTPS ingress только новый bridge; локальный Chatwoot напрямую не публиковать.
- Не запускать campaigns, scheduler, broadcast, batch worker или AI outbound.
- Разрешены ровно одна live inbound acceptance SMS и ровно одна live operator CLI outbound attempt после всех gates. Live Chatwoot-originated outbound запрещён.
- Duplicate, STOP/START, race, retry, failure и destructive scenarios выполнять только signed fixtures/provider fakes.
- Никогда не передавать full phone, PAT, Telnyx API key, signing secrets или SMS text в командной строке, логе, issue или evidence report.
- Если send outcome стал `unknown_needs_review`, не повторять send. Сначала reconcile через Telnyx Portal/MDR/webhooks.

## 2. Prerequisites

### Local tools

- Node.js 22
- Docker with Compose
- PostgreSQL client optional
- HTTPS ingress/tunnel exposing only the new bridge for approved live webhook audit
- Existing local Chatwoot reachable at `http://localhost:3001` (or a same-instance internal-network alias); do not start another Chatwoot service

### Protected configuration

Будущая реализация ожидает секреты во внешнем secret store или uncommitted environment:

```text
DATABASE_URL
CHATWOOT_BASE_URL
CHATWOOT_ACCOUNT_ID
CHATWOOT_INBOX_ID
CHATWOOT_INBOX_IDENTIFIER
CHATWOOT_PAT
CHATWOOT_WEBHOOK_SECRET
TELNYX_API_KEY
TELNYX_PUBLIC_KEY
TELNYX_SENDER_NUMBER
TELNYX_MESSAGING_PROFILE_ID
WEBHOOK_PAYLOAD_KEY_ID
WEBHOOK_PAYLOAD_KEY
PHONE_ENCRYPTION_KEY_ID
PHONE_ENCRYPTION_KEY
PHONE_LOOKUP_HMAC_KEY
READINESS_ARTIFACT_PATH
READINESS_FINGERPRINT_KEY
PUBLIC_INGRESS_ORIGIN
PUBLIC_INGRESS_CERT_SPKI_SHA256
TEST_RECIPIENT_NUMBER
SMOKE_TEST_TEXT
```

`TEST_RECIPIENT_NUMBER` — единственный allowlisted target. CLI не должен иметь `--to` или аналогичный arbitrary-recipient flag.

## 3. Live-audit checklist before implementation send

### Existing local Chatwoot

1. Зафиксировать `http://localhost:3001` (или same-instance internal alias), installed version, account ID и deployment owner без credentials; подтвердить, что это существующий deployment, а не Cloud/second stack.
2. Штатными UI/API operations создать или подтвердить отдельный JAMA SMS API Channel inbox и назначить только необходимых JAMA agents; не менять Telegram/WhatsApp inboxes.
3. Подтвердить inbox ID, inbox identifier, `Channel::Api`, one-conversation/reopen behavior и exact local API routes/payloads.
4. Создать account webhook только с нужной subscription на bridge endpoint; local Chatwoot URL не должен быть public ingress target.
5. Подтвердить на real local delivery exact signature/timestamp/delivery headers, canonical raw-body bytes, freshness behavior и controlled secret rotation. Имена headers из planning artifacts остаются provisional до этого audit.
6. Проверить dedicated PAT: required contact/ContactInbox/conversation/message/status APIs работают, unrelated inbox access минимален.
7. Подтвердить, что валидная подпись configured account/inbox является достаточным MVP authorization evidence; отдельный permission lookup не требуется.
8. Захватить безопасные signed schema fixtures для human outgoing, private note, AgentBot/Captain, unsupported event и, если доступны, campaign/automation; fixtures redacted и не содержат real body/phone.
9. Зафиксировать static baseline: 0 file changes в `C:\work\germes` и 0 configuration changes существующих Telegram/WhatsApp inboxes.

### Telnyx

1. Подтвердить, что fixed sender assigned exact `TELNYX_MESSAGING_PROFILE_ID`.
2. Проверить number type, 10DLC/toll-free compliance state и send restrictions.
3. Установить primary webhook URL на bridge; per-message webhook URLs не использовать.
4. Получить current Ed25519 public key и documented rotation procedure.
5. Подтвердить real signed webhook verification на raw body.
6. Зафиксировать observed events `message.received`, `message.sent`, `message.finalized`, IDs и statuses.
7. Зафиксировать configured/documented STOP-family profile behavior и, для toll-free, carrier auto-response nuances без отправки live STOP/START; runtime validation выполняется fixtures/fakes.

### Authoritative readiness artifact

После аудита создать внешний uncommitted JSON file at `READINESS_ARTIFACT_PATH` and validate it against `contracts/readiness-artifact.schema.json`. It MUST use `schema_version=1`, `status=pass`, `expires_at` no later than seven days after `created_at`, record the observed Chatwoot HMAC result/contract, and contain keyed Chatwoot/Telnyx sender/Telnyx profile/ingress fingerprints plus safe evidence references. If Chatwoot reports `hmac_supported=false`, status cannot be `pass` and implementation remains blocked pending a separate fallback specification.

`specs/001-telnyx-chatwoot-sms/evidence/readiness-audit.md` may explain observations but never enables runtime. Validate the following negative cases before any live traffic: missing file, malformed JSON, schema violation, expired artifact, `fail`, `unresolved`, Chatwoot mismatch, Telnyx sender mismatch, profile mismatch and ingress mismatch. Every case must produce sanitized not-ready/re-audit output, HTTP `503` for live webhook routes, zero durable live receipts and zero provider calls.

## 4. Local validation flow

Названия scripts являются contract для будущего `package.json`; `/speckit-tasks` должен реализовать их без изменения safety semantics.

### Start dependencies

```bash
docker compose up -d postgres
npm ci
npm run db:migrate
```

Expected:

- PostgreSQL 16 healthy;
- migrations complete;
- no provider network calls;
- no secrets printed.

### Run static and automated checks

```bash
npm run typecheck
npm test
npm run test:integration
```

Expected evidence:

- signature tests cover valid/tampered/stale/future payloads;
- duplicate webhook produces one inbox row;
- out-of-order Telnyx events do not regress terminal status;
- suppression survives process/database restart;
- concurrent first-time STOP versus outbound send is serialized and produces zero Telnyx calls;
- two concurrent first inbound messages for one new phone create one Chatwoot conversation and two messages;
- one-submit crash test produces `unknown_needs_review` and zero second calls;
- ambiguous contact, ContactInbox, conversation or message create persists `chatwoot_side_effect.unknown_needs_review`, reconciles only by unique stable evidence, and never blindly performs a second create;
- after committing a conversation `resource_scope_key` and simulating process death during HTTP, a concurrent second inbound cannot create or claim that same conversation scope;
- missing/stale/merged Chatwoot binding or webhook phone mismatch yields `recipient_mapping_needs_review` and zero Telnyx calls;
- wrong Telnyx number/profile/direction, MMS and unknown outbound message IDs are ignored with zero side effects;
- ciphertext is unreadable at rest and purged after terminal processing and always within 24 hours;
- logger snapshots contain no body/full phone/secrets;
- Telegram/WhatsApp regression assertion reports no touched configuration or API calls.

### Start bridge locally

```bash
npm run dev:http
npm run dev:worker
```

Expected health endpoints:

```text
GET /health/live   -> 200 when process is alive
GET /health/ready  -> 200 only when DB/schema/config and current JSON readiness artifact are valid; otherwise 503
```

No send endpoint exists.

## 5. Contract fixture validation

### Telnyx webhook

Replay a signed local fixture through the contract test harness, not through an unsigned curl request.

Expected:

- correct signature + fresh timestamp → 2xx after durable insert;
- same `data.id` again → 2xx duplicate outcome, one DB row;
- bad signature/stale timestamp → 401/403, no payload row;
- validly signed unsupported event type with a valid generic envelope → `200` after durable receipt/dedupe; worker later records `ignored` with zero side effects;
- malformed JSON or missing generic envelope fields → `400`; only authentication/freshness failures → `401/403`;
- request body absent from Pino output.

### Chatwoot webhook

Expected:

- any authentic event with a valid generic envelope → `200` only after durable receipt/dedupe; the HTTP route does not apply account/inbox/event/sender/business filters;
- malformed JSON/schema envelope → `400`; authentication/freshness failures → `401/403`;
- worker projects a signed human `message_created/outgoing` in configured inbox to one `outbound_send`;
- repeated delivery/message ID → existing outcome, no second row/call;
- worker durably marks private, incoming, AgentBot, Captain, template, campaign, automation, wrong inbox and authentic unsupported events as `ignored` with zero Telnyx calls;
- suppressed target → local Chatwoot status `failed`, zero Telnyx calls;
- ambiguous Telnyx fake response → `unknown_needs_review`, exactly one fake call, no worker retry.

## 6. Database durability checks

With Testcontainers or local Docker PostgreSQL:

1. Insert a valid encrypted webhook row.
2. Stop worker after claim and before any external dispatch; restart and verify safe lease recovery.
3. Stop worker immediately after outbound `submitting` commit; restart and verify transition to `unknown_needs_review` with no provider call.
4. Process an inbound event successfully and verify ciphertext/nonce/key ID are purged while source event ID and Chatwoot IDs remain.
5. Activate suppression, restart all processes, and verify pre-send block.
6. Merge/repoint Chatwoot contact binding and verify suppression still references `phone_identity`.

## 7. Live inbound smoke-test

Run only after local/contract checks and readiness audit pass.

1. Start production-like HTTP + worker containers behind approved HTTPS ingress.
2. Send one SMS from the allowlisted test phone to the fixed Telnyx sender.
3. Wait up to 60 seconds.
4. In Chatwoot, confirm:
   - message appears in JAMA SMS API inbox;
   - correct contact/conversation is used;
   - resolved conversation is reopened rather than duplicated.
5. Generate masked operator report.

Required report fields:

```text
masked_sender
telnyx_event_id
telnyx_message_id
bridge_inbox_id
inbound_message_id
chatwoot_account_id
chatwoot_inbox_id
chatwoot_contact_id
chatwoot_conversation_id
chatwoot_message_id
received_at
completed_at
outcome
```

The report must omit SMS text, full phone and credentials.

### Duplicate inbound proof

Replay the same signed event through an approved provider/test harness. Expected:

- zero additional Chatwoot messages;
- one durable inbox identity;
- audit outcome `duplicate`.

If the first Chatwoot create had an ambiguous result, do not replay automatically; move to manual reconciliation.

## 8. Chatwoot-originated outbound validation boundary

Прямое ограничение этой planning session разрешает реальный outbound smoke только через operator CLI на `TEST_RECIPIENT_NUMBER`. Поэтому Chatwoot human path проходит максимально близкую к runtime проверку без второго live SMS:

1. использовать redacted signed payload, captured from a real authorized human `message_created/outgoing` event in the configured inbox;
2. replay его в integration environment с fake Telnyx transport;
3. подтвердить target resolution ровно в `TEST_RECIPIENT_NUMBER`;
4. зафиксировать обязательные local Chatwoot account/inbox/conversation/message IDs и связать Chatwoot message ID → bridge `outbound_send` ID → fake Telnyx message ID;
5. доказать exactly one provider call при duplicate webhook и worker restart;
6. проверить Chatwoot `sent`/`delivered`/`failed` status update requests через API fake;
7. доказать fail-closed для private/AgentBot/Captain/template/campaign/automation/wrong inbox.

Этот evidence обязателен, но не называется live end-to-end Chatwoot→Telnyx proof. Единственный live Telnyx outbound ниже проверяет fixed sender/profile, suppression, one-submit и provider webhooks. Дополнительный реальный Chatwoot-originated SMS запрещён без нового явного разрешения.

## 9. Operator-only outbound smoke-test

### Preflight

- Confirm `TEST_RECIPIENT_NUMBER` is present and exactly matches the protected allowlist.
- Confirm the JSON readiness artifact is schema-valid, unexpired, `pass`, and matches current Chatwoot, Telnyx sender/profile and ingress fingerprints; Markdown-only evidence is insufficient.
- Confirm current suppression state is clear.
- Confirm sender/profile assignment.
- Confirm Telnyx SDK retries are configured to zero.
- Confirm text is non-empty GSM-7, every extension-table character counts as two septets, estimated septets are at most 160 and estimated segment count is exactly one. Reject emoji, UCS-2 and all non-GSM characters before confirmation and before scope insertion.
- Confirm the global durable scope key `001-telnyx-chatwoot-sms:live-outbound-v1` has never been consumed; any prior accepted, rejected, unknown or crashed live attempt permanently forbids a second one.

### Command contract

Message body is read from protected `SMOKE_TEST_TEXT` or stdin; target is never accepted as a CLI argument.

```bash
npm run operator -- smoke-send --confirm-one-submit
```

The CLI must display only masked recipient and ask for explicit confirmation that exactly one Telnyx submission may occur. A rejected/missing confirmation exits before creating the submission boundary.

Expected success flow:

1. one `smoke_test_run` with globally unique permanent scope key;
2. one `outbound_send`, created atomically with the scope directly in `submitting` after final readiness/profile/suppression checks under the global and per-phone locks;
3. `submission_count = 1`;
4. one Telnyx API call;
5. response profile ID equals configured profile;
6. status webhooks correlate to returned message ID;
7. masked report is generated with bridge/Telnyx IDs, timestamps, outcome, `encoding=GSM-7`, `estimated_septets`, `estimated_segments=1`, and the validated readiness artifact digest; `chatwoot_account_id`, `chatwoot_inbox_id`, `chatwoot_conversation_id`, and `chatwoot_message_id` are all `null`, with applicability explicitly `not_applicable`.
8. fixture tests prove 160 default-alphabet septets and 80 extension-table characters are accepted, while 161 default septets, 81 extension characters, emoji and other non-GSM input are rejected. Raw character count is never the decision input.
9. a race test activates suppression after preliminary preflight but before the final transaction; expected result is rollback with no smoke/scope row, zero Telnyx calls and the live allowance still unused. A STOP already durably received before the final claim is projected first.

Expected failure guards:

| Condition | Expected result |
|---|---|
| target env absent/invalid/not allowlisted | exit non-zero, 0 Telnyx calls |
| target suppressed | blocked, 0 Telnyx calls |
| readiness artifact missing/invalid/expired/non-pass or any Chatwoot/Telnyx/ingress mismatch | readiness failure, re-audit required, 0 Telnyx calls |
| sender/profile mismatch | readiness failure, 0 Telnyx calls |
| empty, emoji, UCS-2/non-GSM, >160 GSM-7 septets, or estimated segment count != 1 | exit 2 before confirmation/scope insertion, 0 Telnyx calls |
| timeout/reset/ambiguous 429/5xx | `unknown_needs_review`, exactly 1 call, no retry |
| repeated same run/action | previously stored outcome, 0 additional calls |

## 10. Unknown outcome review

```bash
npm run operator -- review-unknown --id <bridge-send-id>
```

The command shows masked correlation metadata and operator instructions, not SMS content. Operator checks Telnyx Portal/MDR and records one of:

- `found_submitted` with Telnyx message ID/evidence;
- `confirmed_not_found`;
- `unresolved`.

No review outcome transitions the original action back to `ready`. If business still requires a send, the operator creates a new deliberate action after documenting the prior outcome.

## 11. Protected metadata exports

Both exports require an explicit protected file destination. Neither command may use stdout, echo rows to the terminal, or log exported rows.

```bash
npm run operator -- suppression-export --output <protected-path>
npm run operator -- correlation-export --output <protected-path>
```

Expected:

- `suppression-export` contains canonical phone only inside the protected file plus suppression state/evidence metadata;
- `correlation-export` contains only allowlisted bridge/provider/local-Chatwoot IDs, event/action type, timestamps, status/outcome and masked identity;
- correlation rows for inbound and Chatwoot-originated fixture evidence include required Chatwoot IDs;
- CLI-originated smoke correlation explicitly records `chatwoot_account_id`, `chatwoot_inbox_id`, `chatwoot_conversation_id`, and `chatwoot_message_id` as `null` with `chatwoot_ids_applicability=not_applicable`;
- no export contains SMS body, raw payload, full phone in correlation export, credentials, or encryption material;
- protected destination checks fail closed before writing.

## 12. STOP/suppression fixture validation

Do not send live STOP/START messages. Use redacted, correctly signed Telnyx fixtures and fake provider/Chatwoot adapters only:

1. Replay a signed inbound `STOP`-family fixture and verify `autoresponse_type` handling where present.
2. Verify bridge `suppression_current=active` survives process/database restart and duplicate delivery.
3. Replay a signed Chatwoot human outbound fixture for the same contact; expect zero fake Telnyx calls and failed/suppressed feedback to the Chatwoot API fake.
4. Exercise concurrent STOP-vs-send and first-time suppression ordering with deterministic integration fixtures; STOP already durably received must project before the later outbound claim.
5. Replay signed `START`/`UNSTOP` fixtures and verify state becomes `opt_in_claimed_needs_review`, still blocked.
6. Verify no CLI/API in this feature can clear suppression; confirmed opt-in is deferred to a separate specification.

## 13. Completion evidence

The feature is not complete until the later mandatory verify gate captures fresh:

- unit/contract/integration test output;
- authoritative readiness artifact schema/expiry/status/fingerprint validation and every negative mismatch case, with Markdown shown non-authoritative;
- GSM-7 default/extension boundary and non-GSM rejection evidence proving validation occurs before permanent scope consumption;
- spec requirement coverage checklist;
- live inbound correlation report including `inbound_message_id`;
- signed captured Chatwoot-human outbound integration report with exactly one fake provider call and status feedback;
- one and only one live outbound operator CLI report with all four Chatwoot IDs `null`/`not_applicable`;
- duplicate/replay and concurrent first-conversation evidence from fixtures/fakes;
- suppression/restart and concurrent STOP-vs-send evidence from fixtures/fakes only;
- `unknown_needs_review` no-retry evidence;
- protected suppression and metadata-only correlation export evidence with no stdout/logged rows;
- Telegram/WhatsApp and `C:\work\germes` static no-change evidence;
- payload purge and log-redaction evidence.
