# JAMA Platform Capability Audit (Chatwoot + Telnyx vs PRD)

Research date: 2026-09-21. Sources: official Chatwoot/Telnyx docs, GitHub issues,
changelogs. Where marked **RE-VERIFY**, confirm against a live Chatwoot/Telnyx
account before finalizing a spec — search results could not fully confirm
current behavior.

This document satisfies the PRD's "Developer's First Task" and Constitution
Principle I (Platform-Native First): every requirement is classified A
(native) / B (config-integration) / C (custom-dev) / D (not recommended)
before any implementation spec is written.

## Headline finding

The PRD frames this as "mostly native, some configuration." The audit does
not support that framing. Two items are **confirmed hard blockers requiring
custom development**, not configuration:

1. **Chatwoot has no native Telnyx channel.** Only Twilio and Bandwidth are
   built in (Telnyx integration is an open, unimplemented GitHub request:
   chatwoot/chatwoot#15203). JAMA needs a custom API bridge: a service that
   translates Telnyx webhooks into Chatwoot's generic API Channel format and
   vice versa. A community reference bridge exists
   (wildernessfamily/telnyx-chatwoot-integration-bridge) but is not
   production-hardened.
2. **Safe, idempotent, pausable bulk sending is not solved by Chatwoot.**
   A documented bug (chatwoot/chatwoot#12821) shows parallel job execution
   causing duplicate sends to the same recipients on a 3,000-contact WhatsApp
   campaign. Chatwoot's queueing also doesn't throttle to match a channel's
   real rate limit (#13961). Constitution Principle IV (Safe Sending by
   Design) requires per-recipient submission tracking and idempotent
   launch/resume — this must be built in the custom bridge/orchestration
   layer, not assumed from Chatwoot's campaign feature.

Because of (1), the custom bridge becomes the natural place to also solve
(2), plus opt-out suppression enforcement and SMS-specific personalization
fallback (see below) — these are not independent gaps, they compound into
one non-trivial middleware service sitting between Telnyx and Chatwoot.

## Classification table

| # | Requirement | Class | Note |
|---|---|---|---|
| 1 | Contact fields (name, phone) | A | Native contact model |
| 2 | Custom attributes / tags | A | Native (Custom Attributes, Labels) |
| 3 | CSV import w/ column mapping | A/B | Import is native; **arbitrary column mapping UI unconfirmed** — may expect fixed schema |
| 4 | Dedupe/merge by phone on import | A (buggy) | Recent rework claims update-not-duplicate, but open issue (#12325) shows duplicates still created on some imports — do not trust without testing on JAMA's real CSV |
| 5 | CSV export incl. opt-out status | A/C | Export is native; opt-out as an exportable field requires modeling it as a custom attribute first |
| 6 | Audience segmentation + auto-exclude opt-outs | B/C | General contact segmentation is native; **campaign audience appears label-only** (not full filter builder), and **automatic exclusion of opted-out contacts is not a documented feature** — must be enforced procedurally or in custom logic |
| 7 | Campaign creation UI (name, audience, schedule, confirm) | A | Native flow exists; explicit "confirm before send" modal unconfirmed |
| 8 | `{{first_name}}` personalization + fallback | B/C | Liquid fallback syntax exists generally, but a GitHub thread indicates **SMS campaigns specifically may not support template variables** (unlike WhatsApp) — if true, personalization must be pre-rendered per recipient via API, i.e. custom |
| 9 | Test/preview send | C (likely) | No confirmed "send test SMS to self" for SMS/one-off campaigns |
| 10 | Character/segment count, encoding warning | B/C | Live char counter exists; segment count and GSM-7/UCS-2 encoding warnings not confirmed |
| 11 | Campaign status report (sent/delivered/failed/opt-outs) | C (likely) | Per-message delivery status exists; no confirmed aggregated campaign report — likely needs a custom reporting layer from the API/DB |
| 12 | Safe sending: no double-launch, per-recipient state, pause/cancel | C | Confirmed gap (#12821 duplicate-send bug) |
| 13 | Rate limiting/throttling of sends | C | Chatwoot doesn't tune send pacing to the channel's real limit (#13961); throttling must live in Telnyx config + custom middleware |
| 14 | Telnyx integration | C | **No native channel** — mandatory custom bridge |
| 15 | Inbound SMS → conversations, assignment | A | Native, channel-agnostic once bridge delivers messages correctly |
| 16 | Individual 1:1 SMS, search by name/phone | A | Native |
| 17 | AI FAQ answering + escalation | B | Chatwoot Captain does this against a knowledge base with hand-off behavior |
| 17b | Multi-event knowledge isolation (no cross-contamination) | C (likely) | No confirmed per-topic knowledge scoping in one assistant — likely needs multiple Captain assistants per inbox or custom prompt scoping |
| 18 | Human takeover (AI/human/waiting state) | A | Real state machine exists (bot_handoff, manual takeover PR #15438); has a known edge-case reliability bug under queue contention (#15835) to monitor at JAMA's volume |
| 19 | Role separating "can launch campaigns" from "can respond only" | B/D | **Enterprise-plan feature.** Self-hosted Community Edition only has Agent/Administrator — this requirement is not achievable on CE without an Enterprise upgrade or custom role logic |
| 20 | STOP/UNSUBSCRIBE/etc. opt-out handling | B (mostly via Telnyx) | Telnyx handles this **natively at the carrier/profile level** (auto-block, error 40300 on resend) — but suppression must still be reflected in Chatwoot/campaign audience, which is not automatic (ties back to #6) |
| 21 | America/Chicago scheduling | B/C | No unified account timezone; scheduling timezone semantics for a one-off campaign are unconfirmed — verify live, likely needs custom normalization |

**Telnyx-specific (carrier layer):**

| # | Requirement | Class | Note |
|---|---|---|---|
| T1 | Outbound/inbound SMS API + webhooks | A | Native, mature |
| T2 | Delivery/failure status (DLR) | A | Native via `message.sent`/`message.finalized` webhooks |
| T3 | A2P 10DLC registration | B | Real process (Brand → Campaign via TCR), 1-7 business days vetting typical; Trust Score fixed at registration and gates throughput long-term |
| T4 | Number type choice | B | **Toll-free recommended over 10DLC long code** for JAMA's profile: flat 20 MPS/number, simpler registration (~1-2 weeks, no Brand/Campaign), vs. 10DLC's variable/trust-gated throughput. Short code is overkill (8-12wk provisioning, $1,000+/mo) |
| T5 | Throughput / campaign duration | Constraint | Toll-free: 10k msgs ≈ 8 min, 20k ≈ 17 min at 20 MPS. 10DLC: highly variable (well-vetted ~6-33 min; cold/low-trust could be 3-6+ hrs). 4-8hr target is safe on toll-free; at risk on unvetted 10DLC |
| T6 | Rate limiting | A (mechanism) | Telnyx auto-queues above profile limit, up to a **4-hour queue ceiling** — messages beyond that are dropped, not delayed. App must still pace sends to stay inside that window |
| T7 | Idempotency | C | No confirmed idempotency-key header on the send API — dedup is the app's responsibility |
| T8 | STOP keyword handling | A | Native at carrier/profile level; block applies **per messaging profile**, not per number |
| T9 | Webhook reliability | A (mechanism) / C (consumption) | Ed25519-signed, retried ~6x with failover — same event can arrive twice at two URLs; consuming code must dedupe by event ID |
| T10 | Pricing | Info | ~$0.004/segment headline, but realistic effective cost ~$0.0075-0.0085/segment once AT&T/T-Mobile surcharges are added — use the higher figure for the cost-estimate feature. **RE-VERIFY against live account** |
| T11 | Native bulk/campaign batching | C | No true broadcast endpoint; Number Pool sends one recipient per call. The application must loop sends with its own batching/pacing/retry — this is core custom dev |
| T12 | Bulk-send gotchas | Constraint | Warmup is effectively mandatory (staged ramp, not day-one full volume); registering marketing + AI-reply traffic under one campaign use-case risks carrier filtering — may need separate campaign registrations |

## Architecture implication

The system is not "Chatwoot + Telnyx with light glue." It requires a
**custom messaging orchestration service** sitting between them, responsible
for:

- Telnyx ↔ Chatwoot channel bridging (webhook translation both directions)
- Per-recipient send-state tracking, idempotent campaign launch/resume, pacing within Telnyx's queue window
- Opt-out suppression enforcement at audience-selection time
- SMS-specific personalization rendering with fallback (if Chatwoot SMS campaigns lack Liquid support)
- Campaign-level status rollup (sent/delivered/failed/opt-outs) if Chatwoot's native reporting doesn't cover it
- Possibly: multi-assistant routing for event-specific AI knowledge isolation

This should be scoped as its own component in the plan, not treated as
"integration glue."

## Requirements the PRD should reconsider

Per Constitution Governance, these need either acceptance of the gap, a
scope change, or a documented amendment before spec'ing:

- **#19 (campaign-launch permission separation)** requires a Chatwoot
  Enterprise plan if self-hosted CE was assumed. Confirm which Chatwoot
  tier JAMA is licensing before this requirement is spec'd as achievable.
- **#4 (dedupe on import) and #9 (test send)** may not be reliable/available
  natively — confirm on a live instance before promising them as "native"
  in a spec.
- **10DLC vs toll-free (T4)** is a real decision with cost/throughput/
  timeline tradeoffs; recommend toll-free unless JAMA specifically needs a
  local-presence area code number.

## Re-verify before finalizing any spec

- Chatwoot: CSV column-mapping UI, SMS-campaign Liquid/variable support, test-send capability, segment/encoding display, campaign-level reporting, confirmation-modal on send, scheduling timezone behavior — all unconfirmed by docs search, need a live-instance check.
- Telnyx: current 10DLC MPS/trust-score throughput tables, live per-segment pricing including carrier surcharges, whether an idempotency-key header now exists on the send API.
