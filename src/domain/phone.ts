const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (/[^\d+().\s-]/.test(trimmed)) {
    throw new Error('Phone number must be E.164-like');
  }
  const withPrefix = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  const normalized = withPrefix.startsWith('+')
    ? `+${withPrefix.slice(1).replace(/\D/g, '')}`
    : withPrefix.replace(/\D/g, '');

  if (!E164.test(normalized)) {
    throw new Error('Phone number must be E.164-like');
  }

  return normalized;
}
