# Chatwoot Help Center Knowledge Sync

**Status:** Draft for review  
**Date:** 2026-10-15  
**Scope:** Production knowledge source for the JAMA AI bridge

## Goal

Use the published articles in the dedicated Chatwoot Help Center portal `jama-help-center` as the editorial source of truth for Ama's public knowledge, while keeping the bridge reliable when Chatwoot is temporarily unavailable.

The bridge must continue to own SMS intake, OpenAI calls, Chatwoot conversation history, and Telnyx replies. Chatwoot Help Center does not react to SMS; it supplies published content to a bridge synchronization process.

## Authoritative sources and rollout

After rollout:

```text
Chatwoot Help Center published articles = editorial source of truth
PostgreSQL active snapshot              = runtime source used by AI
knowledge-base.md                       = temporary bootstrap fallback
```

Production configuration is intended to be:

```text
AI_KNOWLEDGE_SOURCE=chatwoot
CHATWOOT_HELP_CENTER_SLUG=jama-help-center
```

The local Markdown file is not modified by the service. It remains available only when no valid Help Center snapshot has ever been activated. It can be removed after production validation and a separate cleanup change.

All `published` articles in the dedicated JAMA portal are AI-authoritative. `draft` and `archived` articles are ignored.

## Data flow

```text
Chatwoot Help Center API
        │ periodic pull, published articles only
        ▼
Help Center sync service
        │ normalize, validate, hash, atomically activate
        ▼
PostgreSQL knowledge snapshot
        │ active snapshot read by AI worker
        ▼
OpenAI context
        ▼
Chatwoot conversation history + Telnyx reply
```

The worker performs an initial sync before processing AI traffic and repeats synchronization on a configurable interval, initially five minutes. A transient sync failure does not replace the last active snapshot.

## Chatwoot API contract

The validated production endpoint is:

```text
GET /api/v1/accounts/{CHATWOOT_ACCOUNT_ID}/portals/{CHATWOOT_HELP_CENTER_SLUG}/articles
```

The existing installation returned `200` with:

- `payload[]` articles;
- `id`, `slug`, `title`, `content`;
- `status`;
- `updated_at`;
- pagination/count metadata.

The client must:

1. send `api_access_token` authentication;
2. request the configured locale (`en` initially);
3. follow pagination until all pages are collected;
4. accept only `status=published`;
5. treat an incomplete page sequence or malformed response as a failed sync;
6. never activate a partial result.

## Normalization

Each published article becomes one knowledge document. Normalization must:

- preserve the article title and factual content;
- strip outer Markdown code fences such as `````;
- remove only importer labels such as a leading `Title:` in the title or `Content:` in the body when they are clearly wrappers;
- preserve URLs, names, dates, times, prices, and other factual punctuation;
- avoid broad rewriting or summarization;
- reject empty title/content after normalization.

The sync stores the original article metadata for audit, but OpenAI receives normalized text only.

## PostgreSQL model

Add versioned, bridge-owned knowledge storage in the existing `telnyx_bridge` schema:

### `knowledge_snapshots`

- snapshot ID;
- source (`chatwoot` or `local`);
- profile ID (`jama-ama-v1.3` for compatibility with `AI_DEFAULT_EVENT_ID`);
- content hash;
- article count;
- status (`active`, `failed`);
- created/activated timestamps;
- failure reason metadata without article secrets.

### `knowledge_documents`

- snapshot ID;
- Chatwoot article ID and slug;
- title;
- normalized content;
- source status;
- source `updated_at`;
- position/order;
- created timestamp.

A sync writes a complete new snapshot and documents in one transaction, then atomically marks it active. The previous active snapshot remains available until replacement succeeds. Raw Chatwoot API payloads and secrets are not stored.

## AI loader behavior

The AI knowledge provider selects the source according to `AI_KNOWLEDGE_SOURCE`:

- `chatwoot`: use the active PostgreSQL Chatwoot snapshot; if none exists, use the local Markdown bootstrap fallback;
- `local`: retain the current local-loader behavior for tests and rollback.

The provider returns the same approved-knowledge interface already consumed by the AI pipeline, so OpenAI and SMS processing do not need a second knowledge path. Confirmed-only filtering remains in force for the local fallback. For Chatwoot, publication status is the approval boundary.

`AI_DEFAULT_EVENT_ID=jama-ama-v1.3` remains the stable knowledge profile identifier during migration; it must not cause the worker to require an old event file when the source is Chatwoot.

## Failure and recovery policy

- Chatwoot API unavailable: keep the active PostgreSQL snapshot.
- First sync fails and no snapshot exists: use `knowledge-base.md`.
- API returns malformed or partial data: do not activate it.
- An article is unpublished or archived: it disappears from the next successfully activated snapshot.
- A sync process restarts: it can resume by starting a new complete snapshot; no in-place partial mutation is allowed.
- Database is unavailable: preserve the existing bridge failure behavior; do not silently claim a new knowledge version.

## Configuration

Add/retain configuration for:

```text
AI_KNOWLEDGE_SOURCE=chatwoot
CHATWOOT_HELP_CENTER_SLUG=jama-help-center
CHATWOOT_HELP_CENTER_LOCALE=en
AI_KNOWLEDGE_SYNC_INTERVAL_MS=300000
```

The source selector must be validated. Production `chatwoot` mode requires the Help Center slug and existing Chatwoot API credentials. A safe default for non-production tests remains `local` unless a fake Chatwoot knowledge client is injected.

## Verification plan

Unit tests:

- normalize clean article content;
- strip code fences and importer wrappers;
- reject empty normalized documents;
- filter only published articles;
- paginate API results;
- calculate stable snapshot hashes;
- retain previous active snapshot on sync failure;
- select Chatwoot snapshot versus local fallback.

Integration tests with fake Chatwoot API and PostgreSQL contract tests:

1. publish the founders article and activate one snapshot;
2. verify the AI context contains the normalized article;
3. verify a draft article is excluded;
4. update the article and activate a new version;
5. unpublish it and verify it disappears from the next version;
6. return an API error and verify the previous snapshot remains active;
7. return a partial/malformed page and verify no partial activation;
8. start with no snapshot and verify local Markdown fallback.

Production smoke:

1. deploy with `AI_KNOWLEDGE_SOURCE=chatwoot`;
2. verify worker startup sync and active snapshot count;
3. send a confirmed question such as `Who founded JAMA?`;
4. edit/publish the article in Chatwoot;
5. wait for or trigger sync;
6. verify the next answer uses the new content;
7. create a draft article and verify it is not used;
8. inspect the sync and AI lifecycle logs.

## Non-goals

- Help Center directly answering SMS;
- direct OpenAI-to-Chatwoot Help Center integration;
- writing changes back into the Git repository or Railway filesystem;
- public article rendering changes;
- campaigns or proactive messaging;
- replacing PostgreSQL operational state;
- importing internal safety/prompt rules into a public Help Center.
