export const BRIDGE_SCHEMA = 'telnyx_bridge';

export const POSTGRES_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS ${BRIDGE_SCHEMA};

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.webhook_receipts (
  receipt_id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','processing','completed','retryable','needs_review')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result_code text CHECK (result_code IS NULL OR result_code IN ('processed','retryable','needs_review')),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.webhook_outbox (
  job_id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES ${BRIDGE_SCHEMA}.webhook_receipts(receipt_id),
  published_at timestamptz,
  publication_claimed_by text,
  publication_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.processed_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','unknown_needs_review')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.suppressions (
  phone text PRIMARY KEY,
  source_event_id text NOT NULL,
  suppressed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.conversation_bindings (
  conversation_id bigint PRIMARY KEY,
  phone text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.outbound_actions (
  action_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'submitting' CHECK (status IN ('submitting','sent','unknown_needs_review')),
  telnyx_message_id text,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.ai_decisions (
  inbound_identity text PRIMARY KEY,
  conversation_id bigint NOT NULL,
  inbound_message_id bigint NOT NULL,
  event_id text NOT NULL,
  ai_decision_id text UNIQUE NOT NULL,
  chatwoot_history_message_id bigint,
  telnyx_action_id text UNIQUE,
  telnyx_message_id text,
  outcome text NOT NULL,
  status text NOT NULL,
  state text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  unknown_reason text
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.ai_conversation_state (
  conversation_id bigint PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('ai_active','waiting_for_human','human_active')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.ai_reply_sends (
  phone text NOT NULL,
  ai_decision_id text PRIMARY KEY,
  sent_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS processed_events_event_idx ON ${BRIDGE_SCHEMA}.processed_events (provider, event_id);
CREATE INDEX IF NOT EXISTS suppressions_phone_idx ON ${BRIDGE_SCHEMA}.suppressions (phone);
CREATE INDEX IF NOT EXISTS conversation_bindings_phone_idx ON ${BRIDGE_SCHEMA}.conversation_bindings (phone);
CREATE INDEX IF NOT EXISTS ai_decisions_inbound_idx ON ${BRIDGE_SCHEMA}.ai_decisions (inbound_identity);
CREATE INDEX IF NOT EXISTS ai_decisions_history_idx ON ${BRIDGE_SCHEMA}.ai_decisions (chatwoot_history_message_id);
CREATE INDEX IF NOT EXISTS ai_reply_sends_phone_time_idx ON ${BRIDGE_SCHEMA}.ai_reply_sends (phone, sent_at);

ALTER TABLE ${BRIDGE_SCHEMA}.webhook_receipts ADD COLUMN IF NOT EXISTS result_code text;
ALTER TABLE ${BRIDGE_SCHEMA}.webhook_outbox ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE ${BRIDGE_SCHEMA}.webhook_outbox ADD COLUMN IF NOT EXISTS publication_claimed_by text;
ALTER TABLE ${BRIDGE_SCHEMA}.webhook_outbox ADD COLUMN IF NOT EXISTS publication_claimed_at timestamptz;
`;
