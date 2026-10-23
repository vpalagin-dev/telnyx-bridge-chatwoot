import type { ConversationTurn } from './conversation-history.js';
import type { OpenAiRequest } from './types.js';

export type ChatCompletionMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function buildOpenAiChatMessages(
  request: OpenAiRequest,
  conversationTurns: ConversationTurn[] = [],
): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [{ role: 'system', content: request.systemInstruction }];
  const knowledgeBlock = `Event ${request.eventId}\n${request.approvedContext}`.trim();
  const hasHistory = conversationTurns.length > 0;

  if (hasHistory) {
    if (knowledgeBlock.length > 0) {
      messages.push({ role: 'user', content: knowledgeBlock });
    }
    for (const turn of conversationTurns) {
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: request.customerMessage });
  } else {
    messages.push({
      role: 'user',
      content: knowledgeBlock.length > 0
        ? `${knowledgeBlock}\nCustomer: ${request.customerMessage}`
        : request.customerMessage,
    });
  }

  return messages;
}
