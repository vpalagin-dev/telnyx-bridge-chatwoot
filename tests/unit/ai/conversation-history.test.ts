import { describe, expect, it } from 'vitest';
import { buildConversationTurns, type ChatwootHistoryMessage } from '../../../src/ai/conversation-history.js';

function message(partial: Partial<ChatwootHistoryMessage> & Pick<ChatwootHistoryMessage, 'id' | 'content' | 'messageType'>): ChatwootHistoryMessage {
  return {
    private: false,
    createdAt: partial.createdAt ?? partial.id,
    ...partial,
  };
}

describe('buildConversationTurns', () => {
  it('maps incoming/outgoing to user/assistant in chronological order', () => {
    const turns = buildConversationTurns([
      message({ id: 1, content: 'Hi', messageType: 'incoming', createdAt: 1 }),
      message({ id: 2, content: 'Hello!', messageType: 'outgoing', createdAt: 2 }),
      message({ id: 3, content: 'Coming with my sister', messageType: 'incoming', createdAt: 3 }),
    ], { limit: 20 });

    expect(turns).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Coming with my sister' },
    ]);
  });

  it('excludes the current inbound message and private notes', () => {
    const turns = buildConversationTurns([
      message({ id: 10, content: 'Earlier', messageType: 'incoming', createdAt: 1 }),
      message({ id: 11, content: 'secret', messageType: 'incoming', createdAt: 2, private: true }),
      message({ id: 12, content: 'Current', messageType: 'incoming', createdAt: 3 }),
    ], { excludeMessageId: 12, limit: 20 });

    expect(turns).toEqual([{ role: 'user', content: 'Earlier' }]);
  });

  it('keeps only the most recent messages within the limit', () => {
    const turns = buildConversationTurns([
      message({ id: 1, content: 'old', messageType: 'incoming', createdAt: 1 }),
      message({ id: 2, content: 'mid', messageType: 'outgoing', createdAt: 2 }),
      message({ id: 3, content: 'new', messageType: 'incoming', createdAt: 3 }),
    ], { limit: 2 });

    expect(turns).toEqual([
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: 'new' },
    ]);
  });
});
