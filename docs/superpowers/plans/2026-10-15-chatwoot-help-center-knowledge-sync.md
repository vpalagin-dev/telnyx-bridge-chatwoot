# Chatwoot Help Center Knowledge Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax and must be completed task-by-task.

**Goal:** Make published articles in the Chatwoot `jama-help-center` portal the production AI knowledge source, synchronized into a durable PostgreSQL snapshot with a local Markdown bootstrap fallback.

**Architecture:** A typed Chatwoot Help Center client pulls all article pages, keeps only `published` articles, normalizes their text, and atomically activates a complete snapshot in PostgreSQL. The AI path reads an active Chatwoot snapshot when `AI_KNOWLEDGE_SOURCE=chatwoot`, falling back to the existing local Markdown loader only when no snapshot exists. The worker performs an initial sync and repeats it every five minutes without writing to the Railway filesystem or Git repository.

**Tech Stack:** Node.js 22, TypeScript strict mode, Fastify runtime, PostgreSQL via `pg`, Vitest, existing `OperationalStore` and worker lifecycle, Chatwoot account API using `api_access_token`.

**Spec:** `docs/superpowers/specs/2026-10-15-chatwoot-help-center-knowledge-sync-design.md`

## Global Constraints

- Production source selector is `AI_KNOWLEDGE_SOURCE=chatwoot`.
- Production portal slug is `CHATWOOT_HELP_CENTER_SLUG=jama-help-center`.
- Initial locale is `CHATWOOT_HELP_CENTER_LOCALE=en`.
- Sync interval is `AI_KNOWLEDGE_SYNC_INTERVAL_MS=300000`.
- Only Chatwoot articles with `status=published` are AI-authoritative.
- Draft and archived articles must never enter an active snapshot.
- A partial, malformed, or failed sync must never replace the previous active snapshot.
- The local `knowledge-base.md` is a bootstrap fallback only; the service must not modify the repository or Railway filesystem.
- PostgreSQL remains the durable source for operational state and knowledge snapshots.
- OpenAI and Telnyx behavior must remain unchanged except for the knowledge provider used by `processAiPostInbound`.
- Tests must not call live Chatwoot, OpenAI, or Telnyx services.

---

## File Map

Create:

- `src/ai/chatwoot-knowledge.ts` — Chatwoot Help Center API types, paginated client, and article normalization.
- `src/ai/knowledge-sync.ts` — sync orchestration, snapshot hashing, and periodic sync handle.
- `src/ai/knowledge-provider.ts` — source-neutral AI knowledge interface selecting Chatwoot snapshot or local fallback.
- `src/persistence/knowledge-store.ts` — persistence interfaces and snapshot/document types.
- `src/persistence/postgres-knowledge-store.ts` — PostgreSQL implementation using the existing pool.
- `tests/unit/ai/chatwoot-knowledge.test.ts` — API parsing, pagination, publication filtering, normalization.
- `tests/unit/ai/knowledge-sync.test.ts` — activation, hashing, and failure behavior with fakes.
- `tests/unit/ai/knowledge-provider.test.ts` — Chatwoot/local source selection and fallback.
- `tests/unit/persistence/postgres-knowledge-store.test.ts` — SQL contract tests.
- `tests/integration/persistence/postgres-knowledge-store.test.ts` — disposable PostgreSQL behavior where the environment is available.

Modify:

- `src/config/env.ts` — source, slug, locale, and interval configuration.
- `src/persistence/schema.ts` — `knowledge_snapshots` and `knowledge_documents` tables plus indexes.
- `src/runtime.ts` — construct the Chatwoot Help Center client, knowledge store, provider, and sync service.
- `src/worker.ts` — initialize and stop the sync lifecycle around the existing receipt worker.
- `src/ai/process-ai.ts` — consume the source-neutral knowledge provider instead of directly loading local files.
- `src/ai/knowledge.ts` — preserve the local loader and expose its result through the provider contract.
- `tests/unit/config.test.ts` — source configuration defaults and validation.
- `tests/integration/ai/fake-smoke.test.ts` and related AI fixtures — use a fake knowledge provider where required.
- `specs/002-jama-ai-assistant-smoke/evidence/automated-verification.md` — record the new production source boundary after verification.

---

## Task 1: Add the Chatwoot article client and normalizer

**Files:**
- Create: `src/ai/chatwoot-knowledge.ts`
- Create: `tests/unit/ai/chatwoot-knowledge.test.ts`

**Interfaces:**

```ts
export type ChatwootKnowledgeArticle = {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: string;
  updatedAt: string | number;
  position: number;
};

export type KnowledgeDocument = {
  sourceArticleId: number;
  slug: string;
  title: string;
  content: string;
  sourceUpdatedAt: string;
  position: number;
};

export type ChatwootHelpCenterClient = {
  listPublishedArticles(): Promise<ChatwootKnowledgeArticle[]>;
};

export function normalizeKnowledgeArticle(article: ChatwootKnowledgeArticle): KnowledgeDocument;
export function createChatwootHelpCenterClient(options: {
  baseUrl: string;
  accountId: number;
  apiToken: string;
  portalSlug: string;
  locale: string;
  fetcher?: typeof fetch;
}): ChatwootHelpCenterClient;
```

- [ ] **Step 1: Write failing tests for publication filtering, pagination, and normalization.**

Test the real response shape observed in production:

```ts
const pageOne = {
  payload: [
    { id: 1, slug: 'founders', title: 'Who founded JAMA?', content: '```\\nJAMA! was founded...\\n```', status: 'published', updated_at: 1792090615, position: 10 },
    { id: 2, slug: 'draft', title: 'Private draft', content: 'Do not use', status: 'draft', updated_at: 1792090616, position: 20 },
  ],
  meta: { current_page: 1, articles_count: 1, published_count: 1 },
};
```

Assert that the client requests `GET /api/v1/accounts/6/portals/jama-help-center/articles?locale=en&page=1`, follows a second page when `current_page` is below the reported total/page data, and returns only the published article.

Assert that normalization turns the content into `JAMA! was founded...` without outer code fences, preserves title/URL punctuation, and rejects an article that becomes empty after trimming.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run:

```bash
npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts
```

Expected: FAIL because the client and normalizer do not yet exist.

- [ ] **Step 3: Implement the client and normalizer.**

Use `fetcher` injection for tests. Send `api_access_token` and `Accept: application/json`. Treat non-2xx responses, invalid JSON, missing `payload`, invalid article fields, and an incomplete page response as errors. Use the configured portal slug, not the numeric portal ID. Normalize only known import wrappers and outer code fences; do not summarize or rewrite factual content.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run:

```bash
npx vitest run tests/unit/ai/chatwoot-knowledge.test.ts
```

Expected: all client/normalization tests PASS.

- [ ] **Step 5: Commit the client boundary.**

```bash
git add src/ai/chatwoot-knowledge.ts tests/unit/ai/chatwoot-knowledge.test.ts
git commit -m "feat(ai): add Chatwoot Help Center article client"
```

---

## Task 2: Add durable PostgreSQL knowledge snapshots

**Files:**
- Create: `src/persistence/knowledge-store.ts`
- Create: `src/persistence/postgres-knowledge-store.ts`
- Modify: `src/persistence/schema.ts`
- Create: `tests/unit/persistence/postgres-knowledge-store.test.ts`
- Create: `tests/integration/persistence/postgres-knowledge-store.test.ts`

**Interfaces:**

```ts
export type KnowledgeSnapshot = {
  id: string;
  profileId: string;
  source: 'chatwoot' | 'local';
  contentHash: string;
  articleCount: number;
  activatedAt: string;
};

export type ActiveKnowledge = {
  snapshot: KnowledgeSnapshot;
  documents: KnowledgeDocument[];
};

export interface KnowledgeStore {
  initialize(): Promise<void>;
  activateChatwootSnapshot(profileId: string, documents: KnowledgeDocument[], contentHash: string): Promise<KnowledgeSnapshot>;
  getActiveKnowledge(profileId: string): Promise<ActiveKnowledge | null>;
}
```

- [ ] **Step 1: Write failing SQL contract tests.**

Assert that initialization creates `telnyx_bridge.knowledge_snapshots` and `telnyx_bridge.knowledge_documents`, that activation stores a complete document set, and that a second activation leaves only the new snapshot active for the profile while retaining the previous snapshot for audit. Assert that `getActiveKnowledge('jama-ama-v1.3')` returns documents ordered by `position`.

- [ ] **Step 2: Run the focused unit/contract tests and verify the expected environment-gated failure.**

Run:

```bash
npx vitest run tests/unit/persistence/postgres-knowledge-store.test.ts tests/integration/persistence/postgres-knowledge-store.test.ts
```

Expected: unit contract tests fail before implementation; disposable PostgreSQL tests may be skipped when test services are unavailable, matching existing repository behavior.

- [ ] **Step 3: Add upgrade-safe schema SQL.**

Add tables with:

```sql
knowledge_snapshots(id uuid primary key, profile_id text not null, source text not null, content_hash text not null, article_count integer not null, status text not null, created_at timestamptz not null default now(), activated_at timestamptz)
knowledge_documents(snapshot_id uuid not null references knowledge_snapshots(id), source_article_id bigint not null, slug text not null, title text not null, content text not null, source_updated_at timestamptz not null, position integer not null, primary key(snapshot_id, source_article_id))
```

Use checks for source/status, an index for active profile lookup, and a unique active-snapshot constraint implemented in a PostgreSQL-compatible way. Do not store raw API payloads.

- [ ] **Step 4: Implement transactionally safe activation and reads.**

`activateChatwootSnapshot` must insert the snapshot and all documents in one transaction, deactivate the previous profile snapshot only after all inserts succeed, then mark the new snapshot active. Any exception rolls back and leaves the previous active snapshot unchanged. `getActiveKnowledge` returns `null` when no active snapshot exists.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run:

```bash
npx vitest run tests/unit/persistence/postgres-knowledge-store.test.ts tests/integration/persistence/postgres-knowledge-store.test.ts
```

Expected: contract tests PASS; integration tests PASS when PostgreSQL is available and otherwise remain explicitly skipped.

- [ ] **Step 6: Commit the persistence boundary.**

```bash
git add src/persistence/knowledge-store.ts src/persistence/postgres-knowledge-store.ts src/persistence/schema.ts tests/unit/persistence/postgres-knowledge-store.test.ts tests/integration/persistence/postgres-knowledge-store.test.ts
git commit -m "feat(persistence): store versioned knowledge snapshots"
```

---

## Task 3: Add sync orchestration and failure-safe activation

**Files:**
- Create: `src/ai/knowledge-sync.ts`
- Create: `tests/unit/ai/knowledge-sync.test.ts`

**Interfaces:**

```ts
export type KnowledgeSyncService = {
  syncOnce(): Promise<{ activated: boolean; articleCount: number; contentHash: string }>;
  start(): { stop(): Promise<void> };
};

export function createKnowledgeSyncService(options: {
  client: ChatwootHelpCenterClient;
  store: KnowledgeStore;
  profileId: string;
  intervalMs: number;
  logger?: { info(data: object, message: string): void; error(data: object, message: string): void };
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): KnowledgeSyncService;
```

- [ ] **Step 1: Write failing tests for hash, activation, and failure safety.**

Cover:

1. two identical article lists produce the same SHA-256 content hash;
2. a published article list activates one snapshot;
3. a changed article activates a new snapshot;
4. client error returns a failed sync result and does not call activation;
5. empty published results are valid only when the Help Center response is complete, and never activate a malformed response;
6. `start()` performs an initial sync and schedules another sync at `intervalMs`;
7. `stop()` prevents later scheduled work.

- [ ] **Step 2: Run the focused test and verify it fails.**

```bash
npx vitest run tests/unit/ai/knowledge-sync.test.ts
```

Expected: FAIL because the sync service does not exist.

- [ ] **Step 3: Implement deterministic snapshot hashing and sync.**

Sort normalized documents by `position`, then `sourceArticleId`, serialize stable fields, and hash with Node `crypto.createHash('sha256')`. On successful client fetch, call the store once with the complete document set. Log article count/hash and sanitized errors without article bodies or tokens.

- [ ] **Step 4: Implement the periodic lifecycle.**

Run an immediate `syncOnce()` when `start()` is called, then schedule subsequent attempts. A failed sync logs and schedules the next attempt; it must not stop the worker or mutate the active snapshot. `stop()` clears the timer and awaits any active sync promise.

- [ ] **Step 5: Run the focused tests and verify they pass.**

```bash
npx vitest run tests/unit/ai/knowledge-sync.test.ts
```

Expected: all sync tests PASS.

- [ ] **Step 6: Commit the sync service.**

```bash
git add src/ai/knowledge-sync.ts tests/unit/ai/knowledge-sync.test.ts
git commit -m "feat(ai): sync published Help Center knowledge"
```

---

## Task 4: Add source configuration and the source-neutral AI provider

**Files:**
- Create: `src/ai/knowledge-provider.ts`
- Create: `tests/unit/ai/knowledge-provider.test.ts`
- Modify: `src/config/env.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `src/ai/process-ai.ts`
- Modify: `src/ai/knowledge.ts`

**Interfaces:**

```ts
export type KnowledgeProvider = {
  load(profileId: string): Promise<ApprovedKnowledge>;
};

export function createKnowledgeProvider(options: {
  source: 'chatwoot' | 'local';
  profileId: string;
  localRoot: string;
  localLoader?: KnowledgeLoader;
  store?: KnowledgeStore;
}): KnowledgeProvider;
```

- [ ] **Step 1: Write failing configuration and provider tests.**

Assert that:

- `AI_KNOWLEDGE_SOURCE=chatwoot` parses;
- the default remains `local` for non-production compatibility;
- `CHATWOOT_HELP_CENTER_SLUG` defaults to `jama-help-center` and can be overridden;
- locale defaults to `en`;
- interval defaults to `300000`;
- Chatwoot provider returns active snapshot documents in the existing `ApprovedKnowledge` shape;
- no active snapshot causes local loader fallback;
- local mode calls only the local loader.

- [ ] **Step 2: Run focused tests and verify failures.**

```bash
npx vitest run tests/unit/config.test.ts tests/unit/ai/knowledge-provider.test.ts
```

Expected: FAIL for the new source fields/provider behavior.

- [ ] **Step 3: Implement configuration parsing and `BridgeConfig` fields.**

Add:

```text
AI_KNOWLEDGE_SOURCE=local|chatwoot
CHATWOOT_HELP_CENTER_SLUG
CHATWOOT_HELP_CENTER_LOCALE
AI_KNOWLEDGE_SYNC_INTERVAL_MS
```

Require a non-empty slug when source is `chatwoot`; preserve exact optional-property typing used by the repository.

- [ ] **Step 4: Implement the provider and adapt `processAiPostInbound`.**

Replace the direct `selectDefaultEvent/loadApprovedKnowledge` call in `process-ai.ts` with `d.knowledge.load(ai.defaultEventId ?? 'jama-ama-v1.3')`. Preserve existing decision, fallback, history, and Telnyx behavior. In Chatwoot mode, do not require an old event file. In local mode, preserve confirmed-only filtering and existing tests.

- [ ] **Step 5: Run focused tests and verify they pass.**

```bash
npx vitest run tests/unit/config.test.ts tests/unit/ai/knowledge-provider.test.ts tests/unit/ai/knowledge.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the source-neutral AI provider.**

```bash
git add src/ai/knowledge-provider.ts src/ai/knowledge.ts src/ai/process-ai.ts src/config/env.ts tests/unit/config.test.ts tests/unit/ai/knowledge-provider.test.ts tests/unit/ai/knowledge.test.ts
git commit -m "feat(ai): select Chatwoot or local knowledge source"
```

---

## Task 5: Wire the production client, store, provider, and worker lifecycle

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/worker.ts`
- Modify: `src/worker/process-receipt.ts`
- Modify: `tests/unit/runtime.test.ts`
- Modify: `tests/integration/worker.test.ts`
- Modify: `tests/integration/ai/fake-smoke.test.ts`

**Interfaces:**

Extend `RuntimePipeline` with:

```ts
knowledgeStore: KnowledgeStore;
knowledgeProvider: KnowledgeProvider;
knowledgeSync: KnowledgeSyncService;
```

Extend `ReceiptProcessorDeps` with:

```ts
knowledge: KnowledgeProvider;
```

- [ ] **Step 1: Write failing lifecycle tests.**

Assert that `createRuntimePipeline` constructs the Help Center client and sync service in Chatwoot mode, that the worker initializes the knowledge store before processing receipts, and that `processReceipt` passes the provider to the AI hook. Use injected fakes; no live Chatwoot requests.

- [ ] **Step 2: Run focused lifecycle tests and verify failures.**

```bash
npx vitest run tests/unit/runtime.test.ts tests/integration/worker.test.ts tests/integration/ai/fake-smoke.test.ts
```

Expected: FAIL because the runtime and worker do not yet expose knowledge dependencies.

- [ ] **Step 3: Wire `createRuntimePipeline`.**

Construct one shared `Pool`, `PostgresKnowledgeStore` using that pool, `createChatwootHelpCenterClient` from configured Chatwoot credentials, `createKnowledgeProvider`, and `createKnowledgeSyncService`. Keep `local` source tests free of live API calls by injecting a fake client or selecting the local provider.

- [ ] **Step 4: Run initial sync before receipt processing and stop it cleanly.**

In `src/worker.ts`:

1. initialize receipt, operational, and knowledge stores;
2. start the knowledge sync service;
3. start the existing receipt worker;
4. stop the sync handle before closing Redis/pool.

A failed initial Chatwoot sync must log and continue when the local fallback is available. It must not prevent the worker from starting solely because Chatwoot is temporarily unavailable.

- [ ] **Step 5: Pass the provider through `processReceipt` to the AI hook.**

Keep the existing inbound and outbound paths unchanged. AI receives the provider only after a successful inbound creation, exactly as before.

- [ ] **Step 6: Run focused lifecycle tests and verify they pass.**

```bash
npx vitest run tests/unit/runtime.test.ts tests/integration/worker.test.ts tests/integration/ai/fake-smoke.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit production wiring.**

```bash
git add src/runtime.ts src/worker.ts src/worker/process-receipt.ts tests/unit/runtime.test.ts tests/integration/worker.test.ts tests/integration/ai/fake-smoke.test.ts
git commit -m "feat(worker): activate Chatwoot knowledge sync"
```

---

## Task 6: Run full verification and prepare Railway rollout

**Files:**
- Modify: `specs/002-jama-ai-assistant-smoke/evidence/automated-verification.md`
- Modify: `README.md` if the repository documents runtime variables there

- [ ] **Step 1: Run typecheck, tests, and build.**

```bash
npm run typecheck
npm test
npm run build
```

Expected: typecheck and build pass; all non-environment-gated tests pass; PostgreSQL integration tests are either passing with disposable PostgreSQL or explicitly skipped by their existing environment gate.

- [ ] **Step 2: Inspect the compiled configuration contract.**

Verify the production worker variables are:

```text
AI_KNOWLEDGE_SOURCE=chatwoot
AI_DEFAULT_EVENT_ID=jama-ama-v1.3
CHATWOOT_HELP_CENTER_SLUG=jama-help-center
CHATWOOT_HELP_CENTER_LOCALE=en
AI_KNOWLEDGE_SYNC_INTERVAL_MS=300000
AI_KNOWLEDGE_ROOT=specs/002-jama-ai-assistant-smoke/knowledge
```

Keep `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, and `CHATWOOT_API_TOKEN` unchanged. Do not print tokens or article bodies in logs.

- [ ] **Step 3: Deploy the worker and inspect startup logs.**

Confirm logs show a successful Help Center sync with article count/hash metadata and no API token/content leakage. Confirm the worker remains healthy.

- [ ] **Step 4: Execute production smoke tests.**

Run in order, waiting at least 15 seconds between messages to avoid the AI debounce:

1. Published article question: `Who founded JAMA?` → `answered` and the founders facts.
2. Add/update a published article in Chatwoot, wait for five-minute sync, ask its question → new content is used.
3. Create a draft article with a unique false answer, ask that question → draft content is not used.
4. Unpublish an article, wait for sync, ask its question → fallback/no unsupported answer.
5. Temporarily observe a sync failure or use a test fake to verify the last snapshot remains active.

- [ ] **Step 5: Record evidence and commit final documentation.**

```bash
git add specs/002-jama-ai-assistant-smoke/evidence/automated-verification.md README.md
git commit -m "docs: record Help Center knowledge sync verification"
```

- [ ] **Step 6: Only after production stability, schedule local-file removal.**

Do not remove `knowledge-base.md` in this implementation commit. Remove it only in a later, separately verified change after the Chatwoot snapshot has survived deploy/restart and the fallback behavior is intentionally retired.

---

## Final verification checklist

- [ ] Published Chatwoot article is fetched through the confirmed slug endpoint.
- [ ] Pagination is complete and malformed pages cannot activate.
- [ ] Draft/archived articles never enter active knowledge.
- [ ] Code fences are stripped without rewriting factual content.
- [ ] PostgreSQL snapshot activation is atomic.
- [ ] Previous active snapshot survives sync/API failures.
- [ ] `AI_KNOWLEDGE_SOURCE=chatwoot` selects the Chatwoot provider.
- [ ] Local Markdown is used only when no active Chatwoot snapshot exists.
- [ ] Worker startup sync does not break receipt processing on transient API failure.
- [ ] AI continues to create one Chatwoot history record and one Telnyx attempt per inbound decision.
- [ ] Typecheck, tests, build, and production smoke evidence are complete.
