import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const KNOWLEDGE_GUARD =
  'JAMA-specific facts (events, tickets, team, policies, venues, pricing): use only the approved knowledge provided with the customer message. '
  + 'Do not invent or guess facts. For casual conversation, respond as Ama without using the knowledge base, but never fabricate JAMA details or commitments.';

export function composeAmaSystemInstruction(persona: string): string {
  const trimmed = persona.trim();
  if (!trimmed) return KNOWLEDGE_GUARD;
  return `${trimmed}\n\n---\n${KNOWLEDGE_GUARD}`;
}

export async function loadAmaSystemPrompt(options: {
  inline?: string;
  path: string;
  cwd?: string;
}): Promise<string> {
  if (options.inline?.trim()) return composeAmaSystemInstruction(options.inline);
  const filePath = isAbsolute(options.path) ? options.path : resolve(options.cwd ?? process.cwd(), options.path);
  const persona = await readFile(filePath, 'utf8');
  return composeAmaSystemInstruction(persona);
}
