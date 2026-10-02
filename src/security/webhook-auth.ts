import { createHmac, timingSafeEqual, verify } from 'node:crypto';

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
      input.publicKey,
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
