import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadApprovedKnowledge } from '../../../src/ai/knowledge.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('single-file knowledge base', () => {
  it('returns only explicitly confirmed sections and excludes draft content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jama-knowledge-'));
    directories.push(root);
    await writeFile(join(root, 'knowledge-base.md'), `---
knowledge_id: test-base
version: 1
status: draft
---
# Knowledge Base

## 1.1 Confirmed topic
Status: CONFIRMED
This fact is approved.

## 1.2 Draft topic
Status: DRAFT
This fact must not be sent.

## 1.3 Unconfirmed topic
Status: TBD
This fact must not be sent.
`, 'utf8');

    const result = await loadApprovedKnowledge(root, 'test-base');

    expect(result.eventMarkdown).toContain('This fact is approved.');
    expect(result.eventMarkdown).not.toContain('This fact must not be sent.');
    expect(result.sharedMarkdown).toBe('');
  });
});
