# Local Chatwoot API smoke (no live SMS)

Use this procedure only to create test contact, conversation, and message data in the existing local Chatwoot at `http://localhost:3001`. It does **not** send SMS, configure a Chatwoot webhook, or expose a tunnel.

## Hard limits

- Work only in `C:\work\telnyx`. Do not modify any file under `C:\work\germes`.
- Keep `OUTBOUND_MODE=fake` for every Chatwoot-originated outbound check. Telnyx HTTP is never called in this mode.
- Do not set `OUTBOUND_MODE=live` here. Live Telnyx remains a later, separately gated CLI smoke to `TEST_RECIPIENT_NUMBER`.
- Do not configure a Chatwoot account webhook, inbox webhook, or callback URL.
- Do not start ngrok, Cloudflare Tunnel, or any other public ingress.
- Do not reuse the existing Telegram or WhatsApp inboxes. Create a separate JAMA SMS API inbox.
- Real Chatwoot HTTP is allowed only for inbox/contact/conversation/message setup against `http://localhost:3001`.
- Automated `npm test` already covers signed fixtures and fake Telnyx. This procedure only proves the local Chatwoot API can hold JAMA SMS test records.

## Prerequisites

1. Local Chatwoot is already running at `http://localhost:3001` (the existing deployment; do not start a second stack).
2. You have a Chatwoot agent personal access token. Store it in the bridge `.env` as `CHATWOOT_API_TOKEN`; do not commit it.
3. Bridge `.env` includes:

```env
CHATWOOT_URL=http://localhost:3001
CHATWOOT_ACCOUNT_ID=<existing account id>
CHATWOOT_INBOX_ID=<jama sms api inbox id, after step 1>
CHATWOOT_API_TOKEN=<agent pat>
OUTBOUND_MODE=fake
TEST_RECIPIENT_NUMBER=<your E.164 test phone, unused for Telnyx in this procedure>
TELNYX_SENDER_NUMBER=<fixed sender, unused for Telnyx in this procedure>
```

`TEST_RECIPIENT_NUMBER` may be set now so later live mode has an allowlist, but fake mode never delivers to it.

## 1. Create a separate JAMA SMS API inbox

In the Chatwoot UI at `http://localhost:3001`:

1. Open the existing account. Do not create a second Chatwoot instance.
2. Settings → Inboxes → Add Inbox.
3. Choose **API** (not Telegram, WhatsApp, Twilio, or Email).
4. Name it `JAMA SMS`.
5. Finish the wizard without adding a webhook URL.
6. Copy the numeric inbox id into `CHATWOOT_INBOX_ID`.

Existing Telegram/WhatsApp inbox identifiers must stay unchanged.

## 2. Create test contact and conversation data

Use PowerShell against `http://localhost:3001` only. Replace the token and ids from `.env`. Do not print the token into logs or screenshots.

```powershell
$base = 'http://localhost:3001'
$accountId = $env:CHATWOOT_ACCOUNT_ID
$inboxId = $env:CHATWOOT_INBOX_ID
$token = $env:CHATWOOT_API_TOKEN
$phone = $env:TEST_RECIPIENT_NUMBER
$headers = @{ api_access_token = $token; 'Content-Type' = 'application/json' }

$contact = Invoke-RestMethod -Method Post -Uri "$base/api/v1/accounts/$accountId/contacts" -Headers $headers -Body (@{
  name = 'JAMA SMS smoke'
  phone_number = $phone
  inbox_id = [int]$inboxId
} | ConvertTo-Json)

$sourceId = @(
  $contact.payload.contact.contact_inboxes
) | Where-Object { $_.inbox_id -eq [int]$inboxId } | Select-Object -First 1 -ExpandProperty source_id

$conversation = Invoke-RestMethod -Method Post -Uri "$base/api/v1/accounts/$accountId/conversations" -Headers $headers -Body (@{
  contact_id = $contact.payload.contact.id
  inbox_id = [int]$inboxId
  source_id = $sourceId
  status = 'open'
} | ConvertTo-Json)

$message = Invoke-RestMethod -Method Post -Uri "$base/api/v1/accounts/$accountId/conversations/$($conversation.id)/messages" -Headers $headers -Body (@{
  content = 'Local Chatwoot API smoke — do not deliver'
  message_type = 'outgoing'
  private = $false
} | ConvertTo-Json)

[pscustomobject]@{
  contactId = $contact.payload.contact.id
  conversationId = $conversation.id
  messageId = $message.id
  inboxId = [int]$inboxId
} | Format-List
```

Expected: Chatwoot returns numeric contact, conversation, and message ids. No Telnyx request is made. The new outgoing message stays inside Chatwoot because no webhook is configured.

## 3. Locally replay that action to the fake outbound bridge

This step talks to the local bridge only. It does **not** register the payload as a Chatwoot webhook.

1. Keep `OUTBOUND_MODE=fake`.
2. Bind the Chatwoot conversation to the test phone in the bridge SQLite store (inbound has not created the binding yet):

```sql
INSERT INTO conversation_bindings (conversation_id, phone)
VALUES (<conversationId>, '<TEST_RECIPIENT_NUMBER>');
```

3. Copy `tests/fixtures/chatwoot/outgoing-message.json` and substitute the real `id`, `account.id`, `inbox.id`, and `conversation.id`.
4. Sign and POST the body to `http://127.0.0.1:3000/webhooks/chatwoot` using `CHATWOOT_WEBHOOK_SECRET` and a fresh `x-chatwoot-timestamp`. Do not point Chatwoot at this URL.

Expected bridge response:

```json
{
  "outcome": "sent",
  "actionId": "<chatwoot message id>",
  "telnyxMessageId": "fake-chatwoot-<chatwoot message id>"
}
```

`telnyxMessageId` must start with `fake-chatwoot-`. If the response contains a Telnyx-looking id or the process attempts `https://api.telnyx.com/v2/messages`, stop and set `OUTBOUND_MODE=fake`.

## 4. What this procedure does not do

- Send a live SMS.
- Call Telnyx.
- Configure Chatwoot webhooks.
- Publish the bridge or Chatwoot.
- Change `C:\work\germes`.
- Change Telegram/WhatsApp inbox configuration.

When this smoke is recorded, keep only masked phone numbers and Chatwoot ids. Do not copy message bodies or secrets into git.
