import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');

function normalizeTelnyxPublicKey(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) return trimmed;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return trimmed;
  const raw = Buffer.from(trimmed, 'base64');
  if (raw.length !== 32) return trimmed;
  return createPublicKey({
    key: Buffer.concat([ed25519SpkiPrefix, raw]),
    format: 'der',
    type: 'spki',
  });
}

function isFresh(timestamp: string, toleranceSeconds: number, now = Date.now()): boolean {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && Math.abs(Math.floor(now / 1000) - seconds) <= toleranceSeconds;
}

type TelnyxWebhookInput = {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  publicKey: string | undefined;
  toleranceSeconds: number;
};

export function debugTelnyxWebhook(input: TelnyxWebhookInput, verified: boolean): void {
  if (process.env.TELNYX_WEBHOOK_DEBUG !== 'true') return;
  const publicKey = input.publicKey?.trim() ?? '';
  const compactKey = publicKey.replace(/\s+/g, '');
  let publicKeyBytes: number | null = null;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(compactKey)) {
    try {
      publicKeyBytes = Buffer.from(compactKey, 'base64').length;
    } catch {
      publicKeyBytes = null;
    }
  }
  const signature = input.signature ?? '';
  const diagnostic = {
    event: 'telnyx_webhook_auth',
    verified,
    publicKeyPresent: Boolean(publicKey),
    publicKeyFormat: publicKey.includes('BEGIN') ? 'pem' : publicKeyBytes === 32 ? 'base64_raw_32_bytes' : 'other',
    publicKeyLength: publicKey.length,
    publicKeyBytes,
    publicKeyFingerprint: publicKey ? createHash('sha256').update(publicKey).digest('hex').slice(0, 12) : null,
    timestampPresent: Boolean(input.timestamp),
    timestampFresh: Boolean(input.timestamp && isFresh(input.timestamp, input.toleranceSeconds)),
    signaturePresent: Boolean(signature),
    signatureLength: signature.length,
    signatureLooksBase64: /^[A-Za-z0-9+/]+={0,2}$/.test(signature),
    rawBodyLength: input.rawBody.length,
  };
  process.stderr.write(`[telnyx-webhook-debug] ${JSON.stringify(diagnostic)}\n`);
}

export function verifyTelnyxWebhook(input: TelnyxWebhookInput): boolean {
  if (!input.publicKey) return true;
  if (!input.timestamp || !input.signature || !isFresh(input.timestamp, input.toleranceSeconds)) return false;
  try {
    return verify(
      null,
      Buffer.from(`${input.timestamp}|${input.rawBody}`),
      normalizeTelnyxPublicKey(input.publicKey),
      Buffer.from(input.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export function verifyChatwootWebhook(input: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string | undefined;
  toleranceSeconds: number;
}): boolean {
  if (!input.secret) return true;
  if (!input.timestamp || !input.signature || !isFresh(input.timestamp, input.toleranceSeconds)) return false;
  const expected = createHmac('sha256', input.secret).update(`${input.timestamp}.${input.rawBody}`).digest('hex');
  const supplied = input.signature.replace(/^sha256=/i, '').toLowerCase();
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
