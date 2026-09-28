# Operator CLI Contract

## Purpose and hard boundary

CLI существует только для:

1. readiness/audit просмотра без secrets;
2. review записей `unknown_needs_review`;
3. защищённого suppression export;
4. защищённого metadata-only bridge correlation export;
5. одного outbound smoke-test на единственный `TEST_RECIPIENT_NUMBER`.

CLI не является general send tool. Он не принимает произвольный target, sender, profile, schedule, audience, CSV, list или batch input. Он не создаёт campaigns и не вызывает AI.

## Invocation

Future package script:

```bash
npm run operator -- <command> [options]
```

Interactive/readiness/report output is structured, masked and safe for evidence capture. Export rows are written only to an explicit protected path and are never printed to stdout/stderr or logs. Exit code `0` means requested operation completed; non-zero means fail-closed or manual review.

## Global safeguards

- Load and validate config with Zod before command execution.
- Never print environment values, PAT/API keys, signing/encryption keys or full phones.
- Pino request/body logging remains disabled.
- Acquire an advisory lock for mutating operator commands to prevent concurrent duplicate smoke actions.
- Record operator reference from protected local identity/config, not free-form unauthenticated text.
- Load `READINESS_ARTIFACT_PATH`, validate it against `contracts/readiness-artifact.schema.json`, enforce a maximum seven-day validity window and require `status=pass` plus exact current Chatwoot/Telnyx/ingress fingerprint matches. Markdown or database state alone never makes a command ready.
- Refuse production mutation if database schema version or authoritative readiness validation is incomplete.

## Command: `audit-readiness`

```bash
npm run operator -- audit-readiness
```

Read-only checks:

- PostgreSQL reachable and migrations current;
- required config exists and formats are valid;
- JSON artifact exists, parses, validates with `schema_version=1`, has `status=pass`, is not expired and spans no more than seven days;
- artifact confirms Chatwoot HMAC support and contains the exact observed signing contract; unsupported/unresolved HMAC is not ready;
- current Chatwoot facts, fixed Telnyx sender/profile and public ingress recompute to the artifact's keyed fingerprints;
- provider SDK retries configured to zero;
- one allowlisted recipient exists;
- Markdown-only evidence cannot change `ready`;
- no secret values are emitted.

Example safe output:

```json
{
  "ready": true,
  "artifact": {
    "schema_version": 1,
    "status": "pass",
    "created_at": "ISO-8601",
    "expires_at": "ISO-8601",
    "digest": "sha256:<hex>"
  },
  "matches": {
    "chatwoot": true,
    "telnyx_sender": true,
    "telnyx_profile": true,
    "ingress": true
  },
  "chatwoot": {
    "account_id": 123,
    "inbox_id": 456,
    "channel": "Channel::Api",
    "hmac_supported": true,
    "webhook_signing_verified": true
  },
  "telnyx": {
    "sender": "+1******0000",
    "profile_binding_verified": true,
    "ed25519_verified": true,
    "sdk_retries": 0
  },
  "smoke_target": "+1******1234"
}
```

The command does not perform an SMS send.

## Command: `smoke-send`

```bash
npm run operator -- smoke-send --confirm-one-submit
```

### Inputs

- Recipient: only `TEST_RECIPIENT_NUMBER` from protected environment.
- Content: `SMOKE_TEST_TEXT` or stdin. Content must not be supplied as a CLI argument to avoid shell history.
- Sender: only `TELNYX_SENDER_NUMBER` from config.
- Profile assertion: only `TELNYX_MESSAGING_PROFILE_ID` from config.
- Required boolean flag: `--confirm-one-submit`.

Forbidden options include `--to`, `--from`, `--profile`, `--schedule`, `--file`, `--csv`, `--count`, `--recipients`, `--campaign`, and repeated message inputs.

### Preflight

The command must stop before Telnyx and create zero submissions when any check fails:

1. confirmation flag absent;
2. target absent, invalid E.164, or does not equal the configured allowlist;
3. message text empty, contains any non-GSM/emoji/UCS-2 character, exceeds 160 GSM-7 septets, or has estimated segment count other than one; the GSM extension table counts two septets per character and the bound is not configurable;
4. target has `active` or `opt_in_claimed_needs_review` suppression;
5. authoritative JSON artifact is missing, schema-invalid, expired, non-pass/unresolved, reports HMAC unsupported, or mismatches current Chatwoot, Telnyx sender/profile or ingress fingerprints;
6. sender/profile assignment is absent/mismatched;
7. another unresolved smoke action is active;
8. SDK retry count is not zero;
9. database/readiness unavailable.

### Confirmation prompt

Before creating `outbound_send`, display only:

```text
Recipient: +1******1234
Sender:    +1******0000
Mode:      one Telnyx submission, automatic retry disabled
Unknown result policy: stop and require operator review
Proceed? [type SEND ONCE]
```

Any response other than exact `SEND ONCE` cancels with zero submission.

### Durable execution

1. Before prompting, validate authoritative readiness and calculate GSM-7 encoding/septets/segments. Invalid readiness exits `6`; invalid/empty text exits `2`. Both paths create zero rows and make zero Telnyx calls.
2. After exact typed confirmation, acquire the global smoke advisory lock and the shared per-phone advisory/row locks used by suppression. Reload the readiness artifact and require the same digest/current fingerprint result, then project earlier durable consent events and recheck suppression plus sender/profile assignment.
3. If any final check fails, roll back/exit with no `smoke_test_run`, no `outbound_send`, no consumed scope key and zero Telnyx calls.
4. In the same transaction, insert `smoke_test_run(scope_key="001-telnyx-chatwoot-sms:live-outbound-v1", encoding="GSM-7", estimated_septets=<1..160>, estimated_segments=1, readiness_artifact_sha256=<digest>)`, create exactly one `outbound_send(origin=operator_smoke)` directly in `submitting`, set `submission_count=1` and `submission_started_at`, then commit. The global unique constraint rejects any previously consumed live-smoke allowance.
5. Once this atomic submission claim commits, the scope key is permanent and never deleted/reused after success, explicit rejection, ambiguity or crash.
6. Perform exactly one Telnyx `POST /v2/messages` with `maxRetries:0` outside the transaction.
7. Never call Telnyx again for that run/action.
8. Persist provider ID/status or `unknown_needs_review` metadata.
9. Purge encrypted message content after terminal/manual-review projection.

### Exit codes

| Code | Meaning |
|---:|---|
| `0` | Accepted/delivered evidence recorded. |
| `2` | Preflight/confirmation rejected; zero submissions. |
| `3` | Suppressed; zero submissions. |
| `4` | Explicit provider rejection; one attempted submission maximum. |
| `5` | `unknown_needs_review`; one attempted submission, no retry. |
| `6` | Configuration/readiness failure; zero submissions. |

### Masked report

```json
{
  "run_id": "uuid",
  "send_id": "uuid",
  "recipient": "+1******1234",
  "sender": "+1******0000",
  "origin": "operator_smoke",
  "chatwoot_account_id": null,
  "chatwoot_inbox_id": null,
  "chatwoot_conversation_id": null,
  "chatwoot_message_id": null,
  "chatwoot_ids_applicability": "not_applicable",
  "telnyx_message_id": "uuid-or-null",
  "submission_count": 1,
  "encoding": "GSM-7",
  "estimated_septets": 42,
  "estimated_segments": 1,
  "readiness_artifact_digest": "sha256:<hex>",
  "state": "accepted|delivered|failed|unknown_needs_review",
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601-or-null"
}
```

For `origin=operator_smoke`, all four Chatwoot ID fields MUST be present with JSON `null`, and `chatwoot_ids_applicability` MUST equal `not_applicable`; omitting the fields or using an empty string is invalid. `encoding`, `estimated_septets`, `estimated_segments` and the artifact digest are evidence metadata only. Report never includes text, full phone, credentials, raw provider response or encrypted payload material.

Inbound evidence and Chatwoot-originated fixture evidence follow the opposite rule: applicable local Chatwoot account/inbox/conversation/message IDs are required and MUST NOT be reported as not applicable.

## Command: `review-unknown`

```bash
npm run operator -- review-unknown --id <outbound-send-uuid>
```

`--id` is an internal UUID, not phone/provider secret. The command is read-only until operator chooses a reconciliation annotation.

Displayed evidence:

- internal send/action ID;
- masked sender/recipient;
- Chatwoot account/inbox/conversation/message IDs when applicable;
- dispatch timestamp and unknown reason category;
- known provider event IDs;
- instructions to check Telnyx Portal/MDR.

Allowed annotations:

```text
found_submitted <telnyx-message-id>
confirmed_not_found
unresolved
```

Rules:

- Annotation is audited with operator reference and timestamp.
- Original `outbound_send` never transitions to `ready`.
- `confirmed_not_found` still does not auto-resend; a new human action is required.
- `found_submitted` may attach a verified Telnyx message ID and allow later webhooks/status reconciliation.

## Command: `suppression-export`

```bash
npm run operator -- suppression-export --output <protected-path>
```

This supports JAMA data ownership but does not modify consent. Output columns:

```text
phone_number,suppression_state,effective_at,source,last_event_id
```

Requirements:

- decrypt phones only inside export process;
- output path must be an explicit protected file path and must not be stdout/stderr;
- refuse world-readable destination where platform detection supports it;
- never print or log exported rows;
- audit count/path classification without filename secrets.

## Command: `correlation-export`

```bash
npm run operator -- correlation-export --output <protected-path>
```

This exports bridge-owned metadata for receipt, dedupe, inbound, outbound, status and smoke correlation independently of local Chatwoot contact retention. It is not a suppression export and never decrypts or emits the canonical phone.

Allowlisted columns:

```text
bridge_record_id,source_event_id,event_or_action_type,telnyx_message_id,chatwoot_account_id,chatwoot_inbox_id,chatwoot_conversation_id,chatwoot_message_id,chatwoot_ids_applicability,status,outcome,masked_phone,received_at,completed_at
```

Semantics:

- inbound rows require their local Chatwoot contact/conversation/message correlation where applicable; if contact ID is included by the chosen format, it is also required for completed inbound evidence;
- Chatwoot-originated fixture rows require account, inbox, conversation and message IDs;
- operator-smoke rows set all four Chatwoot ID columns to empty CSV fields representing JSON `null` and set `chatwoot_ids_applicability=not_applicable`;
- other rows use `chatwoot_ids_applicability=applicable`, `pending`, or `unavailable_due_to_failed_processing` as an explicit safe outcome, never silently omitting meaning;
- rows contain no SMS body, raw payload, content presented as text, full phone, credentials, secrets, encryption material or raw provider response.

Path/output requirements are identical to `suppression-export`: explicit protected path only, no stdout/stderr, safe permission checks, no printed/logged rows, and metadata-only audit of export count/path classification.

## Opt-in clearing is out of scope

This slice provides no `confirm-opt-in`, `unsuppress`, delete-suppression, or equivalent command. `START`/`UNSTOP` records `opt_in_claimed_needs_review` and remains blocked. A future feature must separately specify authorized actors, acceptable evidence, evidence timestamp/retention, explicit confirmation and per-phone ordering before any suppression-clearing surface can exist.

## Explicit non-contracts

The CLI MUST NOT expose:

```text
send --to <phone>
send-many
broadcast
campaign
schedule
import-recipients
retry-send
retry-unknown
ai-send
auto-reply
```

No hidden/debug flag may bypass allowlist, suppression, fixed sender, one-submit guard or human confirmation.
