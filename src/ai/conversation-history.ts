export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

export type ChatwootHistoryMessage = {
  id: number;
  content: string;
  messageType: 'incoming' | 'outgoing';
  private: boolean;
  createdAt: number;
};

function mergeTurns(turns: ConversationTurn[]): ConversationTurn[] {
  const merged: ConversationTurn[] = [];
  for (const turn of turns) {
    const prior = merged[merged.length - 1];
    if (prior && prior.role === turn.role) {
      prior.content = `${prior.content}\n${turn.content}`;
    } else {
      merged.push({ ...turn });
    }
  }
  return merged;
}

export function buildConversationTurns(
  messages: ChatwootHistoryMessage[],
  options: { excludeMessageId?: number; limit: number },
): ConversationTurn[] {
  const filtered = messages
    .filter((message) => !message.private && message.content.trim().length > 0)
    .filter((message) => message.id !== options.excludeMessageId)
    .sort((left, right) => left.createdAt - right.createdAt);

  const window = filtered.length > options.limit ? filtered.slice(filtered.length - options.limit) : filtered;

  const turns: ConversationTurn[] = window.map((message) => ({
    role: message.messageType === 'incoming' ? 'user' : 'assistant',
    content: message.content.trim(),
  }));

  return mergeTurns(turns);
}
