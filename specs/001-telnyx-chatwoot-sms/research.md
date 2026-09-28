# Research: Telnyx ↔ local Chatwoot SMS Bridge

**Feature**: `001-telnyx-chatwoot-sms`  
**Date**: 2026-09-22

## Outcome

Выбран отдельный Node.js 22/TypeScript bridge для существующего локального Chatwoot по адресу `http://localhost:3001`. Local Chatwoot API Channel остаётся операторским UI, Application API вызывается с выделенным PAT локального deployment, а точные outbound event и HMAC signing contract считаются audit candidates до подтверждения установленной local версии. Telnyx Messaging API v2 обеспечивает SMS, а PostgreSQL 16 используется как durable inbox/worker.

Chatwoot Cloud и второй Chatwoot stack исключены. `C:\work\germes` остаётся внешним и не изменяется, кроме обычной конфигурации JAMA SMS inbox через Chatwoot UI/API. Публичный ingress публикует только новый bridge; локальный Chatwoot напрямую не публикуется.

В этой фиче нет campaigns, scheduler, broadcast/batch API, audience selection и AI/automation outbound. Chatwoot-originated outbound проверяется только подписанными fixtures с fake Telnyx. Единственный live outbound — ровно одна operator CLI попытка на внешний allowlisted `TEST_RECIPIENT_NUMBER` после прохождения всех gates; единственный live inbound — одна acceptance SMS. STOP/START, duplicate, race, retry и destructive scenarios используют только fixtures/fakes.

## Platform-native/custom classification

| Возможность | Класс | Решение и обоснование |
|---|---:|---|
| Local Chatwoot agents, contacts, conversations, UI | A | Использовать существующий deployment `http://localhost:3001`; собственный inbox/contact UI и второй Chatwoot stack не нужны. |
| Local Chatwoot API Channel | A/B | Создать или настроить отдельный JAMA SMS API inbox штатными UI/API operations, не меняя Telegram/WhatsApp. |
| Chatwoot outbound notification | A/B | Account webhook с subscription `message_created` и worker-side strict human-only filter. |
| Chatwoot webhook signing | A/B | Exact HMAC headers/canonicalization должны быть подтверждены live-аудитом локального deployment до story implementation. |
| Telnyx SMS send/receive/status | A | Messaging API v2 и signed webhooks. |
| Native Chatwoot↔Telnyx transport | C | Не предполагается; custom translation bridge является зафиксированным MVP design. |
| Durable receipt/dedupe/worker | C | PostgreSQL нужен для atomic enqueue, restart recovery, ignored-event audit и one-submit state. |
| Durable suppression | B/C | Telnyx block — defense in depth; JAMA-owned state нужен для pre-send guard/export. |
| Metadata-only exports | C | Protected suppression и correlation exports без body, secrets, stdout или logged rows. |
| Campaigns/scheduler/AI outbound | D | Explicitly prohibited; interfaces и model отсутствуют. |

## Local Chatwoot decisions

### Existing deployment, API Channel and PAT

Sole MVP target — существующий локальный Chatwoot `http://localhost:3001` (или его internal-network alias, указывающий на тот же instance). JAMA SMS API inbox создаётся или настраивается только штатными Chatwoot UI/API operations. Docker Compose этой фичи не содержит Chatwoot service, migration или fork.

Runtime bridge использует Application APIs с `api_access_token`. PAT наследует permissions локального пользователя и не имеет OAuth-like scopes; practical least privilege — отдельный integration user, назначенный только в JAMA SMS inbox настолько узко, насколько позволяет установленная версия Chatwoot.

Live audit является hard gate до любой user-story implementation и должен зафиксировать без secrets:

- exact local base URL/internal alias и подтверждение, что это существующий instance;
- account ID, JAMA SMS inbox ID/identifier и `Channel::Api` behavior;
- PAT behavior для contacts, ContactInboxes, conversations, messages и status updates;
- exact webhook event payload, HMAC headers/canonicalization, freshness и secret rotation behavior;
- отсутствие configuration changes существующих Telegram/WhatsApp inboxes;
- отсутствие direct public ingress к Chatwoot.

Если live audit подтверждает HMAC, валидная подпись по exact observed contract из configured local JAMA SMS inbox достаточна как MVP authorization evidence. Отдельный permission lookup не выполняется; worker всё равно проверяет configured account/inbox, event/message type, human sender и conversation binding. Если HMAC unsupported, Chatwoot-originated implementation остаётся blocked до отдельной утверждённой fallback specification; bearer-only, IP allowlist и unsigned webhook не подставляются автоматически.

### Authoritative readiness artifact

**Decision**: live audit produces an external, uncommitted JSON artifact at `READINESS_ARTIFACT_PATH`, validated by the committed `contracts/readiness-artifact.schema.json`. Markdown notes are supplementary only. The artifact has `schema_version=1`, `created_at`, `expires_at` no later than seven days after creation, `status` (`pass`, `fail`, `unresolved`), observed Chatwoot version/signing result and contract, keyed fingerprints for Chatwoot/Telnyx sender/Telnyx profile/ingress, and safe relative or HTTPS evidence references.

**Fingerprint decision**: artifact producer and runtime share the exact fixed-order UTF-8 canonicalization, current-value sources and deterministic test vectors in `contracts/readiness-fingerprints.md`. Runtime live-probes the recorded Chatwoot version/account/inbox facts, uses current protected configuration/secret values, and computes HMAC-SHA-256 with `READINESS_FINGERPRINT_KEY`; comparisons are constant time. Sender/profile/ingress use canonical E.164, UUID, HTTPS origin and deployed certificate SPKI digest sources. Fingerprints, not raw sender/secret values, are stored in the artifact. Missing, malformed, expired, non-pass or mismatched artifacts fail closed and require re-audit.

**Rationale**: an expiring machine-readable artifact makes audit facts enforceable and prevents stale Markdown or database state from enabling traffic after environment drift.

**Alternatives considered**: committed `.env` facts leak or stale; Markdown cannot be safely parsed; DB-only readiness can survive configuration drift and falsely report ready.

### Inbound mapping

1. Normalize sender to E.164 и resolve bridge-owned phone identity по keyed HMAC.
2. Find/create Contact с `inbox_id`, E.164 `phone_number`, stable external `identifier`.
3. Получить или создать ContactInbox и сохранить `source_id`.
4. Reuse один open conversation из durable binding на phone+JAMA inbox; resolved/closed conversation переоткрывается при новом inbound.
5. Create `incoming`, non-private text message.

Chatwoot search используется только для reconciliation: primary identity/mapping хранится bridge, потому что search может быть пагинирован и вернуть ambiguous results. Каждый create contact/ContactInbox/conversation/message имеет globally unique resource-scoped durable ownership row, committed before I/O. Concurrent inbound не может claim тот же resource. Ambiguous outcome не повторяется вслепую и reconciles только по одному uniquely proven resource.

Для human outbound authoritative target берётся только из `conversation_binding → chatwoot_contact_binding → phone_identity`. Webhook contact phone служит consistency assertion; missing/stale/merged mismatch блокирует send и требует review.

### Route/worker boundary

`POST /webhooks/chatwoot` выполняет только authentication/freshness, exact raw-body capture, JSON/minimal envelope validation, encrypted durable receipt/dedupe и ACK after commit. Route не проверяет account/inbox, `message_created`, direction, sender, private/template/campaign/automation markers или conversation binding.

Authentic events с достаточным envelope, включая unsupported/irrelevant event types, durably принимаются и получают `200`; worker позже проектирует outcome `ignored` без Telnyx side effect. Только missing/invalid authentication получает `401/403`, malformed JSON/schema envelope — `400`, а failure до durable commit — retryable `503`.

### Worker outbound filter

После durable receipt worker принимает событие для outbound только если:

- `event === "message_created"`;
- configured account/inbox IDs совпадают;
- `message_type === "outgoing"`, `private === false`;
- normalized `sender.type === "user"`;
- нет campaign/automation/private/template markers;
- content — non-empty text;
- conversation binding однозначно определяет recipient;
- unique `(account_id, chatwoot_message_id)` ещё не имеет send record.

AgentBot, Captain, incoming, private note, template, campaign, automation, wrong account/inbox и authentic unsupported event durably получают `ignored`. `chatwoot_message_id` — action identity; delivery header, если локальная версия его предоставляет, — дополнительное replay evidence.

### Status feedback

Exact endpoint and accepted states must be confirmed against the installed local Chatwoot version during live audit. Planned mapping:

| Bridge outcome | Local Chatwoot status |
|---|---|
| Telnyx accepted + ID | `sent` |
| finalized delivered | `delivered` |
| terminal failure/suppressed | `failed` с sanitized reason |
| ambiguous submission | `failed`: operator review required |

## Telnyx Messaging API v2 decisions

### Fixed sender

Использовать `POST /v2/messages` с:

```json
{
  "from": "<TELNYX_SENDER_NUMBER>",
  "to": "<single E.164>",
  "text": "<transient decrypted content>",
  "type": "SMS",
  "use_profile_webhooks": true
}
```

Sender, target count и webhook URL не управляются Chatwoot content/CLI flags. Per-message webhook URLs не передаются. Для fixed phone sender `messaging_profile_id` не является selector; exact profile обеспечивается assignment номера, startup/live audit и проверкой response/event metadata.

### SDK retries and one-submit

Telnyx Node SDK по умолчанию может retry connection failures, 408/409/429/5xx. Это небезопасно для неидемпотентного send. Client и конкретный send request обязаны использовать `maxRetries: 0`.

Messaging API не документирует idempotency key. Алгоритм:

1. Validate all guards.
2. Atomic lock + `ready → submitting`, `submission_count=1`, commit.
3. Execute exactly one HTTP request with SDK retries disabled.
4. 2xx + ID → `accepted`.
5. Explicit rejection → terminal for same action.
6. Timeout/reset/ambiguous 429/5xx/malformed success/process death → `unknown_needs_review`.
7. Stale `submitting` recovery никогда не вызывает Telnyx снова.

Operator reconciles against Telnyx Portal/MDR/webhooks. Старое action identity никогда не re-arm. Для всей фичи разрешена только одна live operator CLI attempt; Chatwoot-originated path всегда использует fake Telnyx. The smoke CLI does preliminary checks before confirmation, then under the global smoke lock plus shared per-phone lock atomically revalidates readiness/profile/suppression and creates the permanent scope together with `outbound_send(submitting, submission_count=1)`. A final blocked race creates neither row and does not consume the allowance; once the atomic claim commits, exactly one call is attempted and any crash consumes the allowance.

### Webhook route and worker semantics

Ingress signature contract:

- `telnyx-signature-ed25519`: standard Base64 signature;
- `telnyx-timestamp`: Unix seconds;
- canonical message: `<timestamp>|<raw-request-body>`;
- symmetric tolerance ±300 seconds;
- replay/dedupe по `data.id`.

Route schema intentionally validates only a generic authentic Telnyx event envelope: stable event ID, event type string, occurrence metadata and object payload. It MUST NOT enum-reject authentic unsupported event types. After durable commit, worker recognizes `message.received`, `message.sent` and `message.finalized` and applies business predicates.

`message.received` eligible только для inbound SMS на exact configured sender/profile; status events — только для known correlated outbound message ID. Wrong number/profile/direction, MMS, unknown outbound IDs и unsupported event types durably audited/deduplicated as `ignored` with no Chatwoot/provider side effects and HTTP `200`.

`data.id` — webhook event dedupe identity; `data.payload.id` — message correlation ID. Status находится в `payload.to[].status`; delivered/failed не являются отдельными event types. ACK нужен после durable commit менее чем за 2 секунды.

### Chatwoot create ambiguity

Local Chatwoot create-message также не предполагается idempotent. Safe failures before dispatch retryable; any ambiguous outcome after dispatch becomes `unknown_needs_review` and is reconciled manually. Это важнее availability retry, потому что исключает duplicate Chatwoot messages.

## GSM-7 single-segment decision

**Decision**: implement a small dependency-free GSM 03.38 estimator in `src/outbound/gsm7.ts` rather than using raw JavaScript string length or a broad SMS segmentation package. The default alphabet costs one septet; extension-table characters (`^`, `{`, `}`, `\\`, `[`, `~`, `]`, `|`, `€`, form feed) cost two. Operator smoke accepts only input whose every Unicode code point maps to the permitted GSM-7 tables, total is at most 160 septets and estimated segment count equals one. Emoji, surrogate pairs, UCS-2-only and all other non-GSM characters are rejected before confirmation or durable scope consumption.

**Rationale**: the safety rule is narrow, auditable and non-configurable; a small explicit table prevents library defaults from silently accepting concatenated or UCS-2 messages.

**Alternatives considered**: raw character count is wrong for extension symbols; accepting UCS-2 would lower the one-segment limit and violate the MVP contract; a general segmentation library adds behavior not needed for one guarded smoke send.

**Required tests**: 160 default septets accepted; 161 rejected; 80 extension characters accepted as 160 septets; 81 rejected; mixed extension boundary; emoji, Cyrillic and other non-GSM rejected; empty input rejected. Evidence records encoding/count/segments only, never body.

## Durable suppression

Telnyx default STOP-family включает `STOP`, `STOPALL`, `STOP ALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`. Bridge независимо создаёт append-only suppression evidence и обязательную current state row. Suppression projection, contact/conversation creation и outbound claim используют один per-phone advisory/row lock; already-durable STOP events project before later outbound.

`START`/`UNSTOP` создаёт `opt_in_claimed_needs_review`, но не снимает JAMA suppression; clearing полностью out of scope этого среза. Live STOP/START запрещены для validation: keyword, duplicate, race, retry и destructive checks выполняются подписанными fixtures/provider fakes.

## PostgreSQL durable inbox/worker

PostgreSQL 16 выбран вместо отдельного broker:

- unique event/action constraints и enqueue atomic в одной transaction;
- `FOR UPDATE SKIP LOCKED` поддерживает несколько workers;
- lease recovery и explicit retry/manual-review states;
- durable ignored-event receipt/audit;
- меньше operational components для первого vertical slice.

Safe pre-dispatch failures получают bounded exponential backoff with jitter. Ambiguous side effects не retry. Permanent validation/config failures terminal.

## Encrypted transient payloads and exports

Raw webhook body хранится только как AES-256-GCM ciphertext с random 96-bit nonce, auth tag, versioned key ID и AAD `source:event_id:schema_version`. Ciphertext purged сразу после terminal/manual-review projection; hard TTL 24 часа без hold mechanism. Metadata row остаётся для durable dedupe.

Canonical phone хранится encrypted для send/protected suppression export; deterministic lookup выполняется отдельным HMAC key; logs/reports используют mask. Plaintext SMS body запрещён в durable bridge records, logs, traces, errors и snapshots. Local Chatwoot как conversation platform неизбежно хранит message content.

Operator CLI предоставляет два protected-path exports:

- `suppression-export`: canonical phone plus suppression metadata, written only to a protected file;
- `correlation-export`: metadata-only bridge/provider/Chatwoot IDs, types, timestamps, status/outcome and masked identity.

Ни один export не пишет rows в stdout/logs и не содержит SMS body, raw payload или secrets. Correlation export не требует decrypt full phone.

## Alternatives considered

- **Chatwoot Cloud**: out of scope; MVP обязан использовать существующий local deployment.
- **Second Chatwoot stack/container**: нарушает scope и создаёт ненужную операционную поверхность.
- **Native Chatwoot Telnyx channel**: не предполагается; exact installed local capability всё равно фиксируется live audit, но custom bridge уже является MVP design.
- **Polling Chatwoot**: хуже signed webhook по latency и duplicate control.
- **Memory/Redis queue**: memory теряет data; Redis добавляет component без atomic relation к records.
- **Blind retry/idempotency header**: Messaging endpoint и local Chatwoot create calls не дают подтверждённого idempotency contract.
- **Provider-only suppression**: не обеспечивает JAMA ownership/export.
- **Dynamic sender/number pool**: нарушает fixed-sender scope.
- **Public send endpoint**: запрещён; live smoke доступен только через one-time operator CLI.

## Live-audit hard gate

| Item | Resolution criterion |
|---|---|
| Existing local Chatwoot | `http://localhost:3001`/same-instance internal alias, account ID and installed version captured without secrets; no Cloud/second stack. |
| JAMA SMS API inbox | Correct inbox ID/identifier, `Channel::Api`, agents and one-conversation/reopen behavior verified via normal UI/API configuration. |
| Chatwoot signing | Real local delivery records whether HMAC is supported. If supported, it proves exact headers, canonical bytes, digest encoding, freshness and rotation behavior; stale/tampered fails. If unsupported, implementation remains blocked with no implicit fallback. |
| Readiness artifact | External JSON validates against the committed schema, is `pass`, unexpired (maximum seven days), matches current keyed Chatwoot/Telnyx/ingress fingerprints and references safe audit evidence; Markdown alone never enables runtime. |
| PAT privilege/API contract | Required local calls and status behavior succeed; unrelated inbox access минимален. |
| Bridge-only ingress | Public URL reaches only bridge; local Chatwoot remains private. |
| Sender/profile | Fixed sender assigned exact profile; response/event profile metadata understood. |
| Telnyx signing/events | Raw event verifies; event IDs, retry/status semantics and unsupported-event ACK behavior documented. |
| Compliance | Number type, 10DLC/toll-free status, provider STOP behavior and send restrictions documented without performing live STOP/START. |
| Smoke target | `TEST_RECIPIENT_NUMBER` exists only in protected environment and is the sole allowlisted target. |
| External no-touch baseline | No file changes under `C:\work\germes`; existing Telegram/WhatsApp inbox configuration unchanged. |

## Sources

External documentation informs the planned adapter, but installed local Chatwoot behavior recorded by the hard-gate audit is authoritative for implementation:

- [Chatwoot API overview and PAT authentication](https://developers.chatwoot.com/api-reference/introduction.md)
- [Chatwoot API Channel setup](https://www.chatwoot.com/hc/user-guide/articles/1677839703-how-to-create-an-api-channel-inbox)
- [Chatwoot webhook events](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks)
- [Chatwoot webhook API](https://developers.chatwoot.com/api-reference/webhooks/add-a-webhook.md)
- [Chatwoot contact creation](https://developers.chatwoot.com/api-reference/contacts/create-contact.md)
- [Chatwoot contact inbox creation](https://developers.chatwoot.com/api-reference/contacts/create-contact-inbox.md)
- [Chatwoot conversation creation](https://developers.chatwoot.com/api-reference/conversations/create-new-conversation.md)
- [Chatwoot message creation](https://developers.chatwoot.com/api-reference/messages/create-new-message.md)
- [Chatwoot API Channel status updates](https://developers.chatwoot.com/api-reference/messages/update-message-status.md)
- [Telnyx send message API](https://developers.telnyx.com/api-reference/messages/send-a-message.md)
- [Telnyx messaging webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks.md)
- [Telnyx opt-in/out](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out.md)
- [Telnyx command retry guidance](https://developers.telnyx.com/docs/development/api-fundamentals/reliability/command-retries.md)
- [Telnyx Node SDK webhook implementation](https://github.com/team-telnyx/telnyx-node/blob/e987fca513526ea1052dc8e75a99d7e0468f865f/src/lib/webhooks.ts)
- [Chatwoot webhook implementation](https://github.com/chatwoot/chatwoot/blob/develop/lib/webhooks/trigger.rb)
- [Chatwoot conversation builder](https://github.com/chatwoot/chatwoot/blob/develop/app/builders/conversation_builder.rb)
