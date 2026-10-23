import { buildOpenAiChatMessages } from './openai-messages.js';
import type { OpenAiAdapter, OpenAiDecision, OpenAiRequest } from './types.js';

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class LiveOpenAiAdapter implements OpenAiAdapter {
  constructor(private readonly o: { apiKey: string; model: string; timeoutMs: number; fetcher?: Fetcher }) {}

  async generate(request: OpenAiRequest): Promise<OpenAiDecision> {
    if (request.customerMessage.length > request.maxInputTokens * 4) {
      return { kind: 'error', reason: 'malformed' };
    }
    const fetcher = this.o.fetcher ?? fetch;
    const messages = buildOpenAiChatMessages(request, request.conversationTurns ?? []);
    try {
      const response = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.o.apiKey}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(this.o.timeoutMs),
        body: JSON.stringify({
          model: this.o.model,
          messages,
          max_tokens: request.maxOutputTokens,
        }),
      });
      if (!response.ok) return { kind: 'error', reason: 'provider_error' };
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) return { kind: 'error', reason: 'malformed' };
      return { kind: 'answer', text };
    } catch (error) {
      return {
        kind: 'error',
        reason: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'provider_error',
      };
    }
  }
}
