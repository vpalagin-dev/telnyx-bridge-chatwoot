# Telnyx ↔ local Chatwoot SMS bridge (MVP)

A separate Node.js/TypeScript service that connects Telnyx SMS webhooks to the existing local Chatwoot at `http://localhost:3001`.

## Safety scope

- No public send endpoint.
- Chatwoot-originated outbound is accepted only through the configured signed webhook route.
- Telnyx inbound and Chatwoot outbound actions are deduplicated in SQLite.
- STOP-family commands create durable suppression; suppressed outbound never calls Telnyx.
- Secrets are loaded from environment variables and structured logs redact secret/body/phone fields.
- This repository does not create or modify a Chatwoot stack.
- Tests use fixtures and fakes. Running tests sends no live SMS.
- `OUTBOUND_MODE` defaults to `fake`. Chatwoot outbound never calls the Telnyx HTTP API in fake mode.
- In `live` mode, only `TEST_RECIPIENT_NUMBER` is allowed; any other recipient is rejected before Telnyx.
- Production or non-loopback webhook mode fails closed unless `CHATWOOT_WEBHOOK_SECRET` and `TELNYX_PUBLIC_KEY` are both set.

## Setup

1. Copy `.env.example` to `.env` and supply values outside source control.
2. Keep `CHATWOOT_URL=http://localhost:3001` for the existing local deployment.
3. Install and verify:

```powershell
npm install
npm run typecheck
npm test
```

## Run

```powershell
npm run dev
```

Endpoints:

- `GET /health`
- `POST /webhooks/telnyx`
- `POST /webhooks/chatwoot`

When `TELNYX_PUBLIC_KEY` is configured, Telnyx requests require a fresh `telnyx-timestamp` and valid `telnyx-signature-ed25519` over `<timestamp>|<raw-body>`. When `CHATWOOT_WEBHOOK_SECRET` is configured, Chatwoot requests require a fresh `x-chatwoot-timestamp` and `x-chatwoot-signature` HMAC-SHA256 over `<timestamp>.<raw-body>`. Production (`NODE_ENV=production`) and non-loopback binds (`HOST` other than `127.0.0.1`, `localhost`, or `::1`) refuse to start if either secret is missing.

Keep `OUTBOUND_MODE=fake` for all Chatwoot-originated tests. `live` is not a general send switch: it still rejects every recipient except `TEST_RECIPIENT_NUMBER`, but a matching Chatwoot outbound will call Telnyx. Do not enable it for this smoke, expose a public tunnel, or configure a Chatwoot webhook yet. The local Chatwoot API smoke procedure is in [`docs/local-chatwoot-api-smoke.md`](docs/local-chatwoot-api-smoke.md).

The service intentionally provides no campaign, scheduler, batching, provisioning, analytics, CRM, AI outbound, or arbitrary-recipient API.
