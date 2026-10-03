import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

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

export function verifyTelnyxWebhook(input: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  publicKey: string | undefined;
  toleranceSeconds: number;
}): boolean {
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
