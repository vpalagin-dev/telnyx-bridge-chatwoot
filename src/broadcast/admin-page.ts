import type { BroadcastLabel } from './types.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderBroadcastAdminPage(options: {
  inboxName: string;
  inboxId: number;
  labels: BroadcastLabel[];
  messageMax: number;
  token: string;
  notice?: string;
  error?: string;
  values?: { title?: string; message?: string; label?: string; scheduledAt?: string };
}): string {
  const labelOptions = [
    '<option value="">All contacts in this inbox</option>',
    ...options.labels.map((label) => `<option value="${escapeHtml(label.title)}"${options.values?.label === label.title ? ' selected' : ''}>${escapeHtml(label.title)}</option>`),
  ].join('');

  const notice = options.notice ? `<p class="notice">${escapeHtml(options.notice)}</p>` : '';
  const error = options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>JAMA SMS campaign</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #111827; color: #e5e7eb; }
    main { max-width: 640px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.25rem; margin: 0 0 20px; }
    label { display: block; font-size: 0.875rem; margin: 16px 0 8px; color: #d1d5db; }
    input, textarea, select, button { width: 100%; box-sizing: border-box; border-radius: 8px; border: 1px solid #374151; background: #1f2937; color: #f9fafb; padding: 12px; font: inherit; }
    textarea { min-height: 120px; resize: vertical; }
    .readonly { opacity: 0.85; }
    .counter { text-align: right; font-size: 0.75rem; color: #9ca3af; margin-top: 4px; }
    .actions { display: flex; gap: 12px; margin-top: 24px; }
    button { cursor: pointer; border: none; font-weight: 600; }
    .primary { background: #2563eb; }
    .secondary { background: #374151; }
    .notice { background: #064e3b; border: 1px solid #059669; padding: 12px; border-radius: 8px; }
    .error { background: #7f1d1d; border: 1px solid #dc2626; padding: 12px; border-radius: 8px; }
    .hint { font-size: 0.75rem; color: #9ca3af; margin-top: 6px; line-height: 1.4; }
  </style>
</head>
<body>
  <main>
    <h1>Create SMS campaign</h1>
    ${notice}
    ${error}
    <form id="campaign-form" method="post" action="/admin/broadcast">
      <input type="hidden" name="token" value="${escapeHtml(options.token)}" />
      <input type="hidden" id="scheduled_at_utc" name="scheduled_at_utc" value="" />
      <label for="title">Title</label>
      <input id="title" name="title" maxlength="120" placeholder="Please enter the title of campaign" value="${escapeHtml(options.values?.title ?? '')}" required />
      <label for="message">Message</label>
      <textarea id="message" name="message" maxlength="${options.messageMax}" placeholder="Please enter the message of campaign" required>${escapeHtml(options.values?.message ?? '')}</textarea>
      <div class="counter"><span id="count">0</span> / ${options.messageMax}</div>
      <label for="inbox">Inbox</label>
      <input id="inbox" class="readonly" value="${escapeHtml(options.inboxName)} (ID ${options.inboxId})" readonly />
      <label for="label">Audience</label>
      <select id="label" name="label">${labelOptions}</select>
      <label for="scheduled_at">Scheduled time</label>
      <input id="scheduled_at" name="scheduled_at" type="datetime-local" value="${escapeHtml(options.values?.scheduledAt ?? '')}" required />
      <p class="hint" id="tz-hint"></p>
      <div class="actions">
        <button type="reset" class="secondary">Clear</button>
        <button type="submit" class="primary">Create</button>
      </div>
    </form>
  </main>
  <script>
    const message = document.getElementById('message');
    const count = document.getElementById('count');
    const sync = () => { count.textContent = String(message.value.length); };
    message.addEventListener('input', sync);
    sync();
    const scheduled = document.getElementById('scheduled_at');
    const tzHint = document.getElementById('tz-hint');
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    tzHint.textContent = 'Time is in your local timezone (' + timeZone + '). It is converted to UTC when you click Create.';
    if (!scheduled.value) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      scheduled.value = now.toISOString().slice(0, 16);
    }
    document.getElementById('campaign-form').addEventListener('submit', () => {
      const localValue = scheduled.value;
      if (!localValue) return;
      const asLocal = new Date(localValue);
      if (Number.isNaN(asLocal.getTime())) return;
      document.getElementById('scheduled_at_utc').value = asLocal.toISOString();
    });
  </script>
</body>
</html>`;
}
