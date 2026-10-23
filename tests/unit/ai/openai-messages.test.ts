import { describe, expect, it } from 'vitest';
import { buildOpenAiChatMessages } from '../../../src/ai/openai-messages.js';

const baseRequest = {
  model: 'gpt-4o-mini',
  maxInputTokens: 2048,
  maxOutputTokens: 256,
  systemInstruction: 'system',
  eventId: 'jama-ama-v1.3',
  approvedContext: 'Knowledge line',
  customerMessage: 'What should we wear?',
  safeFallbackText: 'fallback',
};

describe('buildOpenAiChatMessages', () => {
  it('uses the legacy single user block when there is no history', () => {
    const messages = buildOpenAiChatMessages(baseRequest, []);
    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Event jama-ama-v1.3\nKnowledge line\nCustomer: What should we wear?' },
    ]);
  });

  it('inserts knowledge, prior turns, and the current customer message when history exists', () => {
    const messages = buildOpenAiChatMessages(baseRequest, [
      { role: 'user', content: 'I am coming with my sister' },
      { role: 'assistant', content: 'Sounds fun!' },
    ]);

    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Event jama-ama-v1.3\nKnowledge line' },
      { role: 'user', content: 'I am coming with my sister' },
      { role: 'assistant', content: 'Sounds fun!' },
      { role: 'user', content: 'What should we wear?' },
    ]);
  });
});
