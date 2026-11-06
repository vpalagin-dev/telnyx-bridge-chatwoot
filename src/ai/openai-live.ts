import { buildOpenAiChatMessages } from './openai-messages.js';
import type { OpenAiAdapter, OpenAiDecision, OpenAiRequest } from './types.js';

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type MessageContentPart = { type?: unknown; text?: unknown };

function extractMessageText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part: unknown) => {
      if (typeof part === 'string') return part;
      if (typeof part === 'object' && part !== null && typeof (part as MessageContentPart).text === 'string') return (part as MessageContentPart).text as string;
      return '';
    })
    .join('')
    .trim();
  return text || undefined;
}

const MAX_PROVIDER_RETRIES = 1;

export class LiveOpenAiAdapter implements OpenAiAdapter {
  constructor(private readonly o: { apiKey: string; baseUrl?: string; model: string; timeoutMs: number; fetcher?: Fetcher }) {}

  async generate(request: OpenAiRequest, retryCount = 0): Promise<OpenAiDecision> {
    if (request.customerMessage.length > request.maxInputTokens * 4) {
      return { kind: 'error', reason: 'malformed' };
    }
    const fetcher = this.o.fetcher ?? fetch;
    const messages = buildOpenAiChatMessages(request, request.conversationTurns ?? []);
    try {
      const baseUrl = (this.o.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      const response = await fetcher(`${baseUrl}/chat/completions`, {
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
      if (!response.ok) {
        if (retryCount < MAX_PROVIDER_RETRIES) return this.generate(request, retryCount + 1);
        return { kind: 'error', reason: 'provider_error', providerStatus: response.status };
      }
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body?.choices?.[0]?.message?.content;
      const text = extractMessageText(content);
      if (!text) {
        const contentType = Array.isArray(content) ? 'array' : content === null ? 'null' : typeof content;
        if (retryCount < MAX_PROVIDER_RETRIES) return this.generate(request, retryCount + 1);
        return { kind: 'error', reason: 'malformed', providerDetail: `message_content_${contentType}` };
      }
      return { kind: 'answer', text };
    } catch (error) {
      if (retryCount < MAX_PROVIDER_RETRIES) return this.generate(request, retryCount + 1);
      return {
        kind: 'error',
        reason: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'provider_error',
      };
    }
  }
}
