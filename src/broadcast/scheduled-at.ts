export function parseBroadcastScheduledAt(fields: {
  scheduled_at_utc?: string;
  scheduled_at?: string;
}): Date | null {
  const utcRaw = fields.scheduled_at_utc?.trim();
  if (utcRaw) {
    const parsed = new Date(utcRaw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const localRaw = fields.scheduled_at?.trim();
  if (!localRaw) return null;

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(localRaw)) {
    const parsed = new Date(localRaw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(localRaw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
