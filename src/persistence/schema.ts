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
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS ${BRIDGE_SCHEMA}.webhook_outbox (
  job_id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES ${BRIDGE_SCHEMA}.webhook_receipts(receipt_id),
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;


