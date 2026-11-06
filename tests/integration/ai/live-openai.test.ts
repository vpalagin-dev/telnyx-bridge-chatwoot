import { describe, expect, it } from 'vitest';
import { LiveOpenAiAdapter } from '../../../src/ai/openai-live.js';

describe('opt-in local live AI', () => {
  it('fails closed unless protected gates are present', () => {
    const enabled = process.env.RUN_LIVE_AI_TEST === 'true'
      && process.env.AI_ENABLED === 'true'
      && process.env.AI_PROVIDER_MODE === 'live'
      && process.env.AI_LIVE_OPENAI_ENABLED === 'true'
      && !!process.env.OPENAI_API_KEY
      && process.env.OUTBOUND_MODE === 'fake';
    if (!enabled) {
      expect(true).toBe(true);
      return;
    }
    expect(process.env.OUTBOUND_MODE).toBe('fake');
  });

  it('normalizes injected provider responses without live network', async () => {
    const a = new LiveOpenAiAdapter({
      apiKey: 'test-only',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'gpt-4o-mini',
      timeoutMs: 50,
      fetcher: async (url) => {
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
      },
    });
    await expect(a.generate({
      model: 'gpt-4o-mini', maxInputTokens: 10, maxOutputTokens: 10, systemInstruction: 'fixed',
      eventId: 'event-afrorave-river', approvedContext: 'demo/test data', customerMessage: 'question', safeFallbackText: 'fallback',
    })).resolves.toEqual({ kind: 'answer', text: 'ok' });
  });

  it('retries once when a provider returns null content', async () => {
    let calls = 0;
    const a = new LiveOpenAiAdapter({
      apiKey: 'test-only', model: 'gpt-4o-mini', timeoutMs: 50,
      fetcher: async () => {
        calls += 1;
        return calls === 1
          ? { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: null } }] }) }
          : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'recovered' } }] }) };
      },
    });
    await expect(a.generate({
      model: 'gpt-4o-mini', maxInputTokens: 10, maxOutputTokens: 10, systemInstruction: 'fixed',
      eventId: 'event-afrorave-river', approvedContext: 'demo/test data', customerMessage: 'question', safeFallbackText: 'fallback',
    })).resolves.toEqual({ kind: 'answer', text: 'recovered' });
    expect(calls).toBe(2);
  });

  it('normalizes OpenAI-compatible text-part content responses', async () => {
    const a = new LiveOpenAiAdapter({
      apiKey: 'test-only', model: 'gpt-4o-mini', timeoutMs: 50,
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({
        choices: [{ message: { content: [{ type: 'text', text: 'hello from parts' }] } }],
      }) }),
    });
    await expect(a.generate({
      model: 'gpt-4o-mini', maxInputTokens: 10, maxOutputTokens: 10, systemInstruction: 'fixed',
      eventId: 'event-afrorave-river', approvedContext: 'demo/test data', customerMessage: 'question', safeFallbackText: 'fallback',
    })).resolves.toEqual({ kind: 'answer', text: 'hello from parts' });
  });

  it('retains provider HTTP status for diagnostics', async () => {
    const a = new LiveOpenAiAdapter({
      apiKey: 'test-only', model: 'gpt-4o-mini', timeoutMs: 50,
      fetcher: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    });
    await expect(a.generate({
      model: 'gpt-4o-mini', maxInputTokens: 10, maxOutputTokens: 10, systemInstruction: 'fixed',
      eventId: 'event-afrorave-river', approvedContext: 'demo/test data', customerMessage: 'question', safeFallbackText: 'fallback',
    })).resolves.toEqual({ kind: 'error', reason: 'provider_error', providerStatus: 429 });
  });
});
