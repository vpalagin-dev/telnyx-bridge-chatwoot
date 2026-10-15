import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type ApprovedKnowledge = {
  eventId: string;
  event: { status: string; effective_from: string; review_by: string };
  eventMarkdown: string;
  sharedMarkdown: string;
};

type KnowledgeMetadata = Record<string, string>;
type KnowledgeBlock = { heading: string; level: number; lines: string[] };

function parseFrontmatter(text: string): { metadata: KnowledgeMetadata; body: string } {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match?.[1] || match[2] === undefined) throw new Error('invalid_knowledge_frontmatter');
  const metadata: KnowledgeMetadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error('invalid_knowledge_frontmatter');
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { metadata, body: match[2] };
}

function headingLevel(line: string): number | null {
  const normalized = line.replace(/^#+\s*/, '');
  if (/^SECTION\s+/i.test(normalized)) return 1;
  const match = normalized.match(/^(\d+[A-Z]?(?:\.\d+)+)\s+/i);
  return match ? match[1]!.split('.').length : null;
}

function splitBlocks(body: string): KnowledgeBlock[] {
  const blocks: KnowledgeBlock[] = [];
  let current: KnowledgeBlock | undefined;
  for (const line of body.split(/\r?\n/)) {
    const level = headingLevel(line);
    if (level !== null) {
      if (current) blocks.push(current);
      current = { heading: line, level, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function explicitStatus(block: KnowledgeBlock): 'confirmed' | 'excluded' | undefined {
  const text = [block.heading, ...block.lines].join('\n');
  if (/\b(?:DRAFT|TBD|OPEN|UNCONFIRMED)\b|requires\s+(?:team\s+approval|legal\s+review)/i.test(text)) return 'excluded';
  if (/\bstatus\s*:\s*confirmed\b|(?:—|-)\s*confirmed\b|^\s*confirmed\s*$/im.test(text)) return 'confirmed';
  return undefined;
}

function confirmedSections(body: string): string {
  const blocks = splitBlocks(body);
  const included: string[] = [];
  const includedByLevel: boolean[] = [];
  for (const block of blocks) {
    const status = explicitStatus(block);
    const parentIncluded = block.level > 1 && includedByLevel[block.level - 1] === true;
    const include = status === 'confirmed' || (status === undefined && parentIncluded);
    includedByLevel[block.level] = include;
    for (let level = block.level + 1; level < includedByLevel.length; level += 1) includedByLevel[level] = false;
    if (include) included.push(block.lines.join('\n'));
  }
  return included.join('\n\n').trim();
}

export async function loadApprovedKnowledge(root: string, eventId: string, _now?: Date): Promise<ApprovedKnowledge> {
  const file = await readFile(join(resolve(root), 'knowledge-base.md'), 'utf8');
  const { metadata, body } = parseFrontmatter(file);
  if (metadata.knowledge_id !== eventId) throw new Error('event_missing_or_ambiguous');
  const eventMarkdown = confirmedSections(body);
  if (!eventMarkdown) throw new Error('event_has_no_confirmed_knowledge');
  return {
    eventId,
    event: {
      status: metadata.status ?? 'draft',
      effective_from: metadata.effective_from ?? '',
      review_by: metadata.review_by ?? '',
    },
    eventMarkdown,
    sharedMarkdown: '',
  };
}

export type KnowledgeLoader = (root: string, eventId: string, now?: Date) => Promise<ApprovedKnowledge>;

export async function selectDefaultEvent(eventId: string | undefined, loader: KnowledgeLoader, root: string, _now = new Date()) {
  if (!eventId) throw new Error('event_missing');
  return loader(root, eventId);
}
