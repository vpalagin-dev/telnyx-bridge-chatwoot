### Task 4: Add source configuration and source-neutral AI provider

**Files:**
- Create: `src/ai/knowledge-provider.ts`
- Create: `tests/unit/ai/knowledge-provider.test.ts`
- Modify: `src/config/env.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `src/ai/process-ai.ts`
- Modify: `src/ai/knowledge.ts` only as needed to expose the existing local loader contract

**Interfaces:**

```ts
export type KnowledgeProvider = {
  load(eventId: string): Promise<ApprovedKnowledge>;
};

export function createKnowledgeProvider(options: {
  source: 'chatwoot' | 'local';
  profileId: string;
  localRoot: string;
  localLoader?: KnowledgeLoader;
  store?: KnowledgeStore;
}): KnowledgeProvider;
```

- [ ] **Step 1: Write failing configuration/provider tests.**

Assert `AI_KNOWLEDGE_SOURCE=chatwoot` parses; default remains `local` for compatibility; slug defaults to `jama-help-center` and is overridable; locale defaults to `en`; sync interval defaults to `300000`; Chatwoot provider returns active snapshot documents in the existing `ApprovedKnowledge` shape; missing active snapshot falls back to local loader; local mode calls only local loader; and Chatwoot mode does not require old event files.

- [ ] **Step 2: Run focused tests and verify expected failure.**

```bash
npx vitest run tests/unit/config.test.ts tests/unit/ai/knowledge-provider.test.ts
```

Expected: FAIL for the new source/provider behavior before implementation.

- [ ] **Step 3: Implement config parsing.**

Add `AI_KNOWLEDGE_SOURCE=local|chatwoot`, `CHATWOOT_HELP_CENTER_SLUG`, `CHATWOOT_HELP_CENTER_LOCALE`, and `AI_KNOWLEDGE_SYNC_INTERVAL_MS` with the specified defaults. Require a non-empty slug when source is `chatwoot`; preserve repository optional-property typing and existing local defaults.

- [ ] **Step 4: Implement provider and adapt AI processing.**

Replace direct local `selectDefaultEvent/loadApprovedKnowledge` usage in `process-ai.ts` with `d.knowledge.load(ai.defaultEventId ?? 'jama-ama-v1.3')`. Preserve decision, fallback, history, escalation, and Telnyx behavior. In local mode retain confirmed-only filtering and existing tests. In Chatwoot mode use the active PostgreSQL snapshot and fallback to local only when no active snapshot exists.

- [ ] **Step 5: Run focused tests and typecheck.**

```bash
npx vitest run tests/unit/config.test.ts tests/unit/ai/knowledge-provider.test.ts tests/unit/ai/knowledge.test.ts
npm run typecheck
```

Expected: focused tests pass and typecheck exits 0.

- [ ] **Step 6: Commit the source-neutral provider boundary.**

```bash
git add src/ai/knowledge-provider.ts tests/unit/ai/knowledge-provider.test.ts src/config/env.ts tests/unit/config.test.ts src/ai/process-ai.ts src/ai/knowledge.ts
 git commit -m "feat(ai): add source-neutral knowledge provider"
```
