# Feature 002 completion checklist

- [x] Fake OpenAI adapter and fake direct AI Telnyx adapter.
- [x] Gated native-fetch live OpenAI adapter with bounded timeout and no retries.
- [x] Explicit event selection and repository-confined approved demo knowledge.
- [x] Response validation, escalation categories, GSM-7 single-segment validation.
- [x] Separate Chatwoot AI history writer with bridge-owned marker.
- [x] SQLite AI decision/state tables, unique inbound identity, side-effect IDs, sticky human state, restart persistence.
- [x] Post-inbound callback after successful inbound creation; callback failure isolated from inbound acknowledgement.
- [x] Human webhook marker filtering and direct AI Telnyx fan-out separation.
- [x] Fake smoke and marker contract tests pass with no provider calls.
- [x] Existing Feature 001 suite remains green.
- [ ] Local live-AI run: requires protected `OPENAI_API_KEY`, explicit opt-in, local Chatwoot availability, and `OUTBOUND_MODE=fake`.
- [ ] End-to-end live AI SMS: remains blocked pending operational readiness, sender/profile relationship, aggregate live budget, and separate operator approval.
- [ ] Railway deployment: requires managed PostgreSQL/SQLite persistence choice, secret injection, webhook TLS/URL configuration, health checks, and a deployment-specific smoke run.
