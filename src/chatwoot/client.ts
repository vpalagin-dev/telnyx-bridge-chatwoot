export type ChatwootContact = { id: number; sourceId: string };
export type ChatwootConversation = { id: number; status: 'open' | 'pending' | 'resolved' };

export interface ChatwootClient {
  findContactByPhone(phone: string): Promise<ChatwootContact | null>;
  createContact(phone: string): Promise<ChatwootContact>;
  findConversation(contactId: number): Promise<ChatwootConversation | null>;
  createConversation(contactId: number, sourceId: string): Promise<ChatwootConversation>;
  reopenConversation(conversationId: number): Promise<void>;
  createIncomingMessage(conversationId: number, content: string): Promise<{ id: number }>;
}
