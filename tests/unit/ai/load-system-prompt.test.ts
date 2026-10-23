import { describe, expect, it } from 'vitest';
import { composeAmaSystemInstruction, loadAmaSystemPrompt } from '../../../src/ai/load-system-prompt.js';

describe('loadAmaSystemPrompt', () => {
  it('composes persona with knowledge guard', () => {
    const result = composeAmaSystemInstruction('You are Ama.');
    expect(result).toContain('You are Ama.');
    expect(result).toContain('approved knowledge');
  });

  it('loads persona from the default repository file', async () => {
    const result = await loadAmaSystemPrompt({
      path: 'specs/002-jama-ai-assistant-smoke/knowledge/ama-persona.md',
    });
    expect(result).toContain('You are Ama');
    expect(result).toContain('Never AMA');
  });

  it('prefers inline override over file', async () => {
    const result = await loadAmaSystemPrompt({
      inline: 'Inline persona.',
      path: 'specs/002-jama-ai-assistant-smoke/knowledge/ama-persona.md',
    });
    expect(result.startsWith('Inline persona.')).toBe(true);
  });
});
