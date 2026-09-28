<!--
Sync Impact Report
==================
Version change: (template, unversioned) -> 1.0.0
Bump rationale: Initial ratification. All placeholders replaced with
project-specific content derived from docs/PRD.md and AGENTS.md.

Modified principles: N/A (first ratification)

Added sections:
- Core Principles (I-VI)
- Technical Constraints
- Development Workflow
- Governance

Removed sections: none

Templates requiring updates:
- ✅ .specify/templates/plan-template.md (Constitution Check gates filled in)
- ✅ .specify/templates/tasks-template.md (tests made mandatory per Principle VI)
- ✅ .specify/templates/spec-template.md (reviewed, no change needed)
- ✅ AGENTS.md (reviewed, workflow routing already consistent)
- ⚠ .specify/templates/commands/*.md (directory absent in this install;
  command definitions live in .cursor/skills/speckit-*/SKILL.md and were
  not modified)

Follow-up TODOs: none
-->

# JAMA! AI Messaging System Constitution

## Core Principles

### I. Platform-Native First

Chatwoot and Telnyx capabilities MUST be exhausted before any custom code is
written. Every requirement MUST be classified as (A) native, (B) configuration
or integration, (C) custom development, or (D) not recommended, and that
classification MUST be recorded in the feature's research or plan before
implementation begins. Custom development is permitted only for class (C)
requirements, and the plan MUST state why the native or configured path is
insufficient.

Rationale: The PRD's primary cost and maintenance risk is rebuilding features
the platforms already provide. A small team cannot sustain a parallel campaign,
inbox, or contact system.

### II. Consent and Suppression Are Absolute

A phone number that has opted out MUST never receive a marketing message unless
the contact has validly opted back in. Opt-out status MUST be stored as a
durable suppression record, never as a deleted contact, and MUST survive CSV
re-import, duplicate merging, and audience re-selection. Audience selection
MUST exclude suppressed numbers automatically; excluding them MUST NOT depend
on a staff member remembering to filter. Standard opt-out keywords (STOP,
UNSUBSCRIBE, CANCEL, END, QUIT) MUST be processed on every inbound channel.

Rationale: Carrier compliance and A2P/10DLC registration depend on this. A
single violation risks number suspension and the whole sending capability.

### III. Humans Initiate Outbound

Outbound SMS MUST be initiated only by a human sending an individual message, a
human creating and confirming a campaign, or an automation JAMA has explicitly
configured and approved. The AI agent MUST NOT decide who to contact or when.
The AI MAY draft message text for a human to send. This principle admits no
exceptions and no configuration flag that disables it.

Rationale: The PRD names this as a hard requirement. Autonomous outbound from an
AI is the fastest path to a mass-send incident and a compliance failure.

### IV. Safe Sending by Design

Every campaign send path MUST be idempotent: a campaign MUST NOT be launched
twice, and a cancelled or resumed campaign MUST NOT resend to recipients
already submitted. Submission state per recipient MUST be tracked. Large sends
MUST require an explicit confirmation step that shows the recipient count and,
where practical, segment count and estimated cost. Personalization MUST fall
back to a configured alternative when a variable is empty; a message containing
an empty greeting, "undefined", "null", or an unrendered template token MUST
NOT be sent. Rate limiting MUST respect Telnyx and carrier limits so that the
carrier, not application design, bounds throughput.

Rationale: The PRD's reliability section lists duplicate sends, broken
personalization, and accidental mass campaigns as the failures to prevent.
These are cheaper to prevent structurally than to remediate after 10,000
messages have gone out.

### V. JAMA Owns Its Data

Contacts, attributes, tags, and suppression status MUST be exportable by an
administrator as CSV at any time without developer involvement. No feature MAY
store contact data in a location that is not covered by that export. Phone
number is the canonical contact identifier; imports MUST merge on phone number
and MUST NOT silently overwrite populated fields with empty values.

Rationale: The PRD requires portability so JAMA is never locked into Chatwoot
or any vendor, and duplicate handling that preserves existing information.

### VI. Evidence Before Completion

Feature work MUST follow test-driven development: tests are written and observed
to fail before implementation. A feature MUST NOT be marked complete without
fresh, run-local verification evidence (test output plus a spec-coverage
checklist) captured by the mandatory verify gate. Throughput claims for large
campaigns MUST be measured against the real Telnyx account and documented, not
assumed. Any requirement that cannot be tested MUST be rewritten until it can.

Rationale: An autonomous coding agent implements most of this system. The
Superpowers Bridge gates exist so that "done" means proven, not asserted.

## Technical Constraints

- **Providers**: Telnyx is the sole SMS provider. Chatwoot is the staff interface
  for contacts, conversations, campaigns, and AI handoff.
- **Scale**: The system MUST handle 10,000 contacts today and 20,000+ without
  redesign. A large campaign SHOULD complete in 4 to 8 hours and MUST complete
  in under 24 hours given approved carrier throughput.
- **Compliance**: A2P/10DLC registration, messaging profile setup, and carrier
  requirements MUST be verified and documented before the first production
  campaign.
- **Timezone**: Scheduling MUST use America/Chicago.
- **AI knowledge**: The AI MUST answer only from JAMA-approved knowledge, MUST
  keep event-specific facts separated per event, and MUST escalate to a human
  rather than guess. Once a human takes over a conversation, the AI MUST stay
  silent until the conversation is deliberately returned to AI handling.
  Conversation state (AI, human, waiting for human) MUST be visible to staff.
- **Permissions**: Launching a campaign MUST be a distinct permission from
  responding to conversations, where Chatwoot supports the distinction.
- **Out of scope for V1**: link tracking, URL shortening, per-recipient unique
  links, purchase or revenue attribution, customer scoring, and analytics
  dashboards. Features in this list MUST NOT be built without a constitution
  amendment.

## Development Workflow

- Formal features run the full Spec Kit cycle: specify, clarify, plan, tasks,
  implement. The Superpowers Bridge gates (plan-gate, controller, verify) are
  mandatory and MUST NOT be skipped or disabled per feature.
- Small fixes, refactors, and ad hoc changes with no open Spec Kit artifact use
  the `dev-task` skill. Its planning stage MUST NOT run while a feature has an
  active spec, plan, or tasks file.
- Every plan MUST pass the Constitution Check in the plan template before
  research begins and again after design. A violation MUST be listed in the
  plan's Complexity Tracking table with the simpler alternative and why it was
  rejected.
- Every spec that touches outbound messaging MUST state how it satisfies
  Principles II, III, and IV in its requirements. Every spec that touches
  contact data MUST state how it satisfies Principle V.
- Communication follows the information-design rules in AGENTS.md: lead with the
  outcome, then rationale, then detail.

## Governance

This constitution supersedes all other project practices, including skill
defaults and template examples. Where a template or extension conflicts with a
principle here, the principle wins and the template MUST be updated.

Amendments require: a written proposal describing the change and its
rationale, an update to this file with a new version and amendment date, and
propagation to the plan, spec, and tasks templates in the same change.
Versioning follows semantic versioning: MAJOR for removing or redefining a
principle, MINOR for adding a principle or materially expanding guidance, PATCH
for clarifications and wording.

Compliance is reviewed at three points: the plan Constitution Check, the
pre-implementation controller gate, and the post-implementation verify gate.
Reviewers MUST reject work that violates Principles II or III outright; those
two principles are not subject to the Complexity Tracking justification path.

**Version**: 1.0.0 | **Ratified**: 2026-09-21 | **Last Amended**: 2026-09-21
