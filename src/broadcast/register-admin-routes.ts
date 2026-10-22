import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BridgeConfig } from '../config/env.js';
import { renderBroadcastAdminPage } from './admin-page.js';
import type { BroadcastStore, ChatwootAudienceClient } from './types.js';

function frameAncestors(config: BridgeConfig): string {
  const chatwoot = config.chatwoot.url.replace(/\/$/, '');
  return `'self' ${chatwoot}`;
}

function readToken(query: unknown, body: unknown): string | undefined {
  const fromQuery = typeof query === 'object' && query !== null && 'token' in query
    ? String((query as { token?: unknown }).token ?? '')
    : '';
  const fromBody = typeof body === 'object' && body !== null && 'token' in body
    ? String((body as { token?: unknown }).token ?? '')
    : '';
  const value = (fromBody || fromQuery).trim();
  return value || undefined;
}

function authorize(config: BridgeConfig, token: string | undefined): boolean {
  const expected = config.broadcast?.adminToken;
  return Boolean(expected && token && token === expected);
}

function replyHtml(reply: { header(name: string, value: string): unknown; type(type: string): { send(body: string): unknown } }, config: BridgeConfig, html: string) {
  reply.header('Content-Security-Policy', `frame-ancestors ${frameAncestors(config)}`);
  return reply.type('text/html; charset=utf-8').send(html);
}

export function registerBroadcastAdminRoutes(
  app: FastifyInstance,
  deps: {
    config: BridgeConfig;
    store: BroadcastStore;
    audience: ChatwootAudienceClient;
  },
): void {
  if (!deps.config.broadcast?.enabled) return;

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const params = new URLSearchParams(String(body ?? ''));
    const parsed: Record<string, string> = {};
    for (const [key, value] of params.entries()) parsed[key] = value;
    done(null, parsed);
  });

  app.get('/admin/broadcast', async (req, reply) => {
    const token = readToken(req.query, undefined);
    if (!authorize(deps.config, token)) return reply.code(401).type('text/plain').send('Unauthorized');
    const labels = await deps.audience.listLabels().catch(() => []);
    const notice = typeof req.query === 'object' && req.query !== null && 'created' in req.query
      ? 'Campaign scheduled. SMS will send after the scheduled time.'
      : undefined;
    const broadcast = deps.config.broadcast!;
    return replyHtml(reply, deps.config, renderBroadcastAdminPage({
      inboxName: broadcast.inboxDisplayName,
      inboxId: deps.config.chatwoot.inboxId,
      labels,
      messageMax: broadcast.messageMaxLength,
      token: token!,
      ...(notice ? { notice } : {}),
    }));
  });

  app.post('/admin/broadcast', async (req, reply) => {
    const body = req.body as Record<string, string> | undefined;
    const token = readToken(req.query, body);
    if (!authorize(deps.config, token)) return reply.code(401).type('text/plain').send('Unauthorized');

    const title = body?.title?.trim() ?? '';
    const message = body?.message?.trim() ?? '';
    const label = body?.label?.trim() || null;
    const scheduledRaw = body?.scheduled_at?.trim() ?? '';
    const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : new Date();
    const maxLen = deps.config.broadcast!.messageMaxLength;

    if (!title || !message || Number.isNaN(scheduledAt.getTime())) {
      const labels = await deps.audience.listLabels().catch(() => []);
      return replyHtml(reply, deps.config, renderBroadcastAdminPage({
        inboxName: deps.config.broadcast!.inboxDisplayName,
        inboxId: deps.config.chatwoot.inboxId,
        labels,
        messageMax: maxLen,
        token: token!,
        error: 'Fill in title, message, and scheduled time.',
        values: { title, message, scheduledAt: scheduledRaw, ...(label ? { label } : {}) },
      }));
    }
    if (message.length > maxLen) {
      const labels = await deps.audience.listLabels().catch(() => []);
      return replyHtml(reply, deps.config, renderBroadcastAdminPage({
        inboxName: deps.config.broadcast!.inboxDisplayName,
        inboxId: deps.config.chatwoot.inboxId,
        labels,
        messageMax: maxLen,
        token: token!,
        error: `Message must be at most ${maxLen} characters.`,
        values: { title, message, scheduledAt: scheduledRaw, ...(label ? { label } : {}) },
      }));
    }

    await deps.store.createCampaign({
      campaignId: randomUUID(),
      title,
      message,
      inboxId: deps.config.chatwoot.inboxId,
      label,
      scheduledAt,
    });

    return reply.redirect(`/admin/broadcast?token=${encodeURIComponent(token!)}&created=1`);
  });
}
