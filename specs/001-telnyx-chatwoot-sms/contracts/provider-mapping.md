# Provider API and Event Mapping Contract

Этот контракт фиксирует boundary между bridge, существующим локальным Chatwoot `http://localhost:3001` и Telnyx. Chatwoot Cloud и второй Chatwoot stack исключены; `C:\work\germes` остаётся внешним и не изменяется. Публичный ingress принимает только bridge webhooks, не публикуя local Chatwoot. Контракт не является копией полных provider schemas: ingress schemas валидируют generic envelope для durable receipt, а worker-side schemas fail closed на обязательных business/safety fields.

## 1. Chatwoot Application API

**Authentication**: planned `api_access_token: <CHATWOOT_PAT>`; exact installed-version behavior is a live-audit hard gate  
**Base URL**: configured `CHATWOOT_BASE_URL`, whose MVP value is `http://localhost:3001` or a same-instance internal-network alias  
**Account**: every route uses configured `CHATWOOT_ACCOUNT_ID` and dedicated `CHATWOOT_INBOX_ID`.

JAMA SMS inbox/webhook configuration uses only normal local Chatwoot UI/API operations. Existing Telegram/WhatsApp inbox configuration is not changed. PAT никогда не отправляется в query string и не логируется. Provider response body логируется только через allowlisted serializer. Exact paths, accepted fields, status behavior and signing contract must be captured from the installed local deployment before story implementation; examples below are the expected Application API shape, not permission to substitute Cloud or another instance.

### Create contact

```http
POST /api/v1/accounts/{account_id}/contacts
Content-Type: application/json
api_access_token: <secret>
```

```json
{
  "inbox_id": 123,
  "phone_number": "+15551234567",
  "identifier": "jama-sms:<stable-nonphone-id>"
}
```

Bridge stores returned `contact.id` and matching `contact_inboxes[].source_id`. Name is optional; bridge does not derive/store a name from SMS body.

### Attach existing contact to API inbox

```http
POST /api/v1/accounts/{account_id}/contacts/{contact_id}/contact_inboxes
```

```json
{
  "inbox_id": 123,
  "source_id": "<stable-source-id>"
}
```

Use only during reconciliation/attach; uniqueness conflicts are manual-review conditions.

### Create conversation

```http
POST /api/v1/accounts/{account_id}/conversations
```

```json
{
  "source_id": "<contact-inbox-source-id>",
  "inbox_id": 123,
  "contact_id": 456,
  "status": "open"
}
```

The returned `id` is stored as `chatwoot_conversation_id` and used in subsequent account conversation routes.

### Reopen conversation fallback

```http
POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/toggle_status
```

```json
{ "status": "open" }
```

Normal inbound API message creation may reopen the conversation automatically. Use explicit toggle only when live-audited behavior requires it; audit possible assignment/AI side effects before enabling.

### Create inbound message

```http
POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages
```

```json
{
  "content": "<transient SMS text>",
  "message_type": "incoming",
  "private": false,
  "content_type": "text"
}
```

Chatwoot does not document an idempotency key for this call. Therefore:

- safe failure before dispatch may retry;
- 2xx with message ID commits correlation;
- timeout/reset/ambiguous response after dispatch becomes `unknown_needs_review`;
- the same inbound action must not blindly invoke message-create again.

The `inbound_message` ledger commits `chatwoot_submitting` before HTTP I/O and retains Telnyx event/message IDs, bridge record ID, phone identity, Chatwoot contact/conversation/message IDs, outcome and review metadata after payload purge. Duplicate Telnyx events return this stored correlation chain.

Contact/ContactInbox/conversation resolution begins under the per-phone lock, but crash safety does not rely on holding a database transaction across HTTP. Before I/O, each create claims and commits a unique durable `chatwoot_side_effect.resource_scope_key`: contact/contact-inbox/conversation scopes are shared across all inbound messages for the same phone/account/inbox, while message scope uses Telnyx message ID. A concurrent inbound conflict reuses `completed`, defers on `submitting`, or stops on `unknown_needs_review`; it never issues another create. Ambiguous result is reconciled by stable contact identifier, inbox/source tuple or contact/inbox conversation relationship. Zero or multiple candidates stay manual review. Thus two first inbound events cannot create two conversations, including across process death.

### Update outbound message status

```http
PATCH /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages/{message_id}
```

Accepted bodies:

```json
{ "status": "sent" }
```

```json
{ "status": "delivered" }
```

```json
{
  "status": "failed",
  "external_error": "Submission outcome unknown; operator review required"
}
```

`external_error` is sanitized and never contains provider raw body, credential, full phone, or SMS text.

## 2. Chatwoot `message_created` webhook

### Authentication and live-audit contract

No Chatwoot signing header, canonicalization formula, digest encoding or freshness window is assumed by this contract. Live audit of the installed local deployment MUST first record whether HMAC is supported and, when supported, the exact observed header names/casing, signed byte sequence, digest representation, freshness/replay behavior, delivery identity and secret rotation behavior in the authoritative JSON readiness artifact.

The route is activated only when the artifact is schema-valid, current, `status=pass`, `hmac_supported=true`, and its Chatwoot/signing fingerprints match the current environment. If HMAC is unsupported or unresolved, Chatwoot-originated implementation remains blocked until a separate fallback specification is approved. Bearer-only authentication, IP allowlisting and unsigned webhooks are not implicit fallbacks.

### HTTP receipt boundary

The route authenticates, captures exact raw body, parses JSON, validates only a generic envelope containing a non-empty `event`, encrypts the payload, durably inserts/deduplicates it, commits, and returns `200`. It does not evaluate account/inbox, event type, direction, sender, private/template/campaign/automation markers or conversation binding.

- missing/invalid authentication or freshness failure → `401/403`, no payload receipt;
- malformed JSON or missing generic envelope fields → `400`;
- authentic supported, irrelevant, or unsupported event → durable receipt/dedupe and `200` (`accepted`, `duplicate`, or later worker-projected `ignored`);
- failure before durable commit → `503` so delivery may retry.

When the observed contract provides no delivery ID, dedupe uses an audited stable resource/event key where available, otherwise the authenticated raw-payload hash for an unsupported generic event without a resource ID.

### Worker eligibility predicate

After durable receipt, all checks are required before a Telnyx side effect:

```text
event == message_created
account.id == CHATWOOT_ACCOUNT_ID
inbox.id == CHATWOOT_INBOX_ID
conversation.inbox_id == CHATWOOT_INBOX_ID
message_type == outgoing
private == false
lower(sender.type) == user
content is non-empty text
no attachment/template requirement
additional_attributes.campaign_id absent
content_attributes.automation_rule_id absent
chatwoot message id not previously submitted
```

Missing/null worker safety fields fail closed for business processing. Authentic ineligible or unsupported events already received `200` from the route and are projected by the worker to a durable `ignored` outcome with zero Telnyx calls.

### Authoritative recipient resolution

For an eligible webhook, resolve only:

```text
(configured account_id, inbox_id, conversation.id)
  -> conversation_binding
  -> chatwoot_contact_binding
  -> phone_identity
  -> decrypted canonical E.164
```

Webhook `contact.phone_number` is never the authoritative destination; it may only be normalized and compared as a consistency assertion. Missing/stale binding, merged-contact mismatch, wrong inbox/account, multiple candidates or failed reconciliation yields `recipient_mapping_needs_review`, updates Chatwoot with a safe failure when possible, and performs zero Telnyx calls.

### Identity and dedupe

- Business action identity: `(account_id, message_id)`.
- Delivery identity: the exact live-audited delivery identifier when the observed contract supplies one.
- Stable fallback inbox key: `message:<message_id>:message_created`.
- Duplicate delivery returns stored outcome and never creates another Telnyx request.

## 3. Telnyx Messaging API v2

**Authentication**: `Authorization: Bearer <TELNYX_API_KEY>`  
**Client retry policy**: `maxRetries: 0` globally and for send request.

### Send one fixed-sender SMS

```http
POST https://api.telnyx.com/v2/messages
Content-Type: application/json
Authorization: Bearer <secret>
```

```json
{
  "from": "+15550000000",
  "to": "+15551234567",
  "text": "<transient message content>",
  "type": "SMS",
  "use_profile_webhooks": true
}
```

Contract restrictions:

- `from` is always exact configured `TELNYX_SENDER_NUMBER`;
- one `to` only;
- no `send_at`, media, group MMS, number pool or dynamic sender;
- no per-message `webhook_url`/`webhook_failover_url`;
- `messaging_profile_id` is not used as a fixed-number selector; sender assignment is verified separately;
- before dispatch, the authoritative JSON readiness artifact must be valid, unexpired, `pass`, and match current Chatwoot, sender, profile and ingress fingerprints computed exactly as specified in `readiness-fingerprints.md`; absent/stale/non-pass/mismatched evidence blocks send and requires re-audit;
- after a 2xx with valid message ID, unexpected `data.messaging_profile_id` does not turn the already submitted SMS into a rejection: keep `accepted`, set `configuration_mismatch_after_submission`, alert/manual-review, continue status correlation, and never retry or replace solely because of the mismatch.

### Operator-smoke text guard

This guard applies only to the one-time live operator CLI path; Chatwoot-originated outbound remains signed-fixture + fake-Telnyx only in this feature. Before confirmation, durable scope insertion or Telnyx dispatch, every Unicode code point must map to the GSM 03.38 default or extension table. Default characters cost one septet; extension characters (`^`, `{`, `}`, `\\`, `[`, `~`, `]`, `|`, `€`, form feed) cost two. Text is eligible only when non-empty, at most 160 septets, and estimated segment count equals one. Emoji, UCS-2 and any non-GSM input fail with zero submissions. Raw character count is not an eligibility signal. After confirmation, the CLI takes the global smoke and shared per-phone locks and atomically revalidates readiness/profile/suppression while creating the permanent scope and `outbound_send(submitting, submission_count=1)`. A failed final check consumes no scope; a committed claim permits exactly one call and cannot be retried.

### Response classification

| Observation | Bridge result | Same action retried? |
|---|---|---:|
| 2xx with valid `data.id` | `accepted` | No |
| explicit deterministic 4xx validation/block | `rejected_permanent` | No |
| timeout or connection reset after dispatch | `unknown_needs_review` | No |
| 429/5xx after dispatch | `unknown_needs_review` | No |
| malformed/missing ID in apparent success | `unknown_needs_review` | No |
| process death after `submitting` commit | `unknown_needs_review` on recovery | No |

An explicit retryable provider error can be surfaced to an operator, but the same Chatwoot action is never automatically or manually re-armed. A new send requires a new human action.

## 4. Telnyx webhooks

### Signature

```text
telnyx-signature-ed25519: <standard Base64 signature>
telnyx-timestamp: <unix seconds>
canonical bytes: <timestamp>|<exact raw body>
algorithm: Ed25519 with TELNYX_PUBLIC_KEY
freshness: abs(now - timestamp) <= 300 seconds
```

The current Node SDK helper is asynchronous; implementation must `await` verification and preserve raw valid UTF-8 JSON exactly. Signature validation occurs before parsing into business objects.

### HTTP receipt boundary

The Telnyx route authenticates/freshness-checks exact raw bytes, parses JSON, and validates only a generic event envelope (`data.id`, non-empty `data.event_type`, `data.occurred_at`, `data.record_type=event`, object `data.payload`). `event_type` is deliberately not enum-constrained at route level. After encrypted durable insert/dedupe commits, every authentic envelope receives `200`, including unsupported event types.

Only missing/invalid authentication receives `401/403`; malformed JSON/generic envelope receives `400`; durable-commit failure receives `503`. Direction, SMS/MMS, number/profile, supported event type and known-message correlation are worker concerns.

### Worker event eligibility matrix

A valid Telnyx signature proves account origin, not JAMA scope. After durable receipt, apply these predicates before any business side effect:

| Event | Required predicate | Signed but unrelated outcome |
|---|---|---|
| `message.received` | `direction=inbound`, `type=SMS`, exactly one relevant `to.phone_number` equals `TELNYX_SENDER_NUMBER`, and `messaging_profile_id` equals configured profile when present | `ignored`; no Chatwoot contact/conversation/message |
| `message.sent` | `direction=outbound`, `payload.id` matches known `outbound_send.telnyx_message_id` | `ignored`; no status mutation |
| `message.finalized` | same known outbound correlation and configured sender/profile consistency where present | `ignored`; no status mutation |
| any MMS, wrong number/profile/direction, unknown event | out of scope | `ignored` after durable safe audit/dedupe |

Wrong-scope events may retain only safe event ID/type/outcome metadata; encrypted payload follows the normal immediate purge/24-hour maximum rule.

### Supported events

| Event | Purpose | Correlation |
|---|---|---|
| `message.received` | inbound SMS and STOP/START evidence | `data.id` event; `payload.id` message |
| `message.sent` | outbound reached sent/carrier stage | `payload.id == outbound_send.telnyx_message_id` |
| `message.finalized` | terminal delivery outcome | same message ID; status in `payload.to[].status` |

Do not expect `message.delivered` or `message.failed` event types.

### Status mapping

| Telnyx status | Bridge status | Chatwoot status |
|---|---|---|
| `queued`, `sending` | `accepted` | no regression/update required |
| `sent` | `sent` | `sent` |
| `delivered` | `delivered` | `delivered` |
| `sending_failed`, `expired` | `delivery_failed` | `failed` |
| `delivery_failed` | `delivery_failed` | `failed` |
| `delivery_unconfirmed` | `delivery_unconfirmed` | `failed` with sanitized explanation |

Events may arrive out of order. Terminal states do not regress when a late `message.sent` arrives.

### Opt-out mapping

Normalize trimmed case-insensitive exact command text and/or Telnyx `autoresponse_type`:

| Input | Suppression event | Current state |
|---|---|---|
| STOP-family | `opt_out` | `active` |
| Provider block observed | `provider_block_observed` | `active` |
| START/UNSTOP | `opt_in_claimed_needs_review` | still blocked |

This feature never clears an opted-out identity. `START`/`UNSTOP` remains blocked/manual-review; confirmed opt-in is deferred to a separate specification.

Every `phone_identity` has a persistent `suppression_current` row. Suppression projection and outbound claim acquire the same per-phone advisory/row locks and process already-durable consent events before later outbound actions. A missing state row is fail-closed. Thus first-time STOP and concurrent STOP-vs-send cannot be overtaken by outbound dispatch.

STOP/START, duplicate, race, retry and destructive validation uses signed fixtures/provider fakes only. The single live inbound acceptance SMS is not a consent-keyword test.

## 5. Runtime readiness behavior

At startup and before each live webhook acceptance or Telnyx dispatch, runtime reloads/validates `READINESS_ARTIFACT_PATH` and compares keyed current-environment fingerprints. Missing, malformed, schema-invalid, expired, `fail`/`unresolved`, HMAC-unsupported or mismatched artifacts make runtime not ready, return sanitized `503` on webhook routes before durable receipt, and perform zero live provider/Chatwoot side effects. A process does not remain ready from a previously cached artifact after expiry or environment change. Markdown evidence cannot override this state.

## 6. Error taxonomy

| Category | Meaning | Retry policy |
|---|---|---|
| `invalid_signature` | Provider authenticity failed | Never; reject request |
| `stale_timestamp` | Replay/future timestamp outside 300s | Never; reject request |
| `invalid_payload` | Required schema/safety field missing | Permanent/manual audit |
| `duplicate` | Existing source event/action identity | Return stored outcome |
| `dependency_unavailable_pre_dispatch` | Failure proven before side effect dispatch | Bounded retry |
| `provider_rejected` | Explicit provider rejection | Terminal for action |
| `unknown_after_dispatch` | Side effect may have occurred | `unknown_needs_review`, no retry |
| `suppressed` | Durable suppression active | Block before Telnyx |
| `configuration_mismatch` | account/inbox/sender/profile mismatch | Fail closed until corrected |

## 7. Privacy contract

Transient provider content may exist only:

- as exact raw request bytes during verification;
- as AES-256-GCM ciphertext in `webhook_inbox` before processing;
- in worker memory during one operation;
- inside Chatwoot/Telnyx provider systems as required for delivery.

Bridge durable metadata may store IDs, timestamps, statuses, content hash, encrypted canonical phone, masked phone and sanitized error codes. It must not store plaintext SMS body in tables, Pino fields, traces, audit JSON, error messages or test snapshots.
