# Task 5 Report: Runtime and Worker Knowledge Wiring

## Implemented

- Extended `RuntimePipeline` with one shared-pool `PostgresKnowledgeStore`, source-neutral `KnowledgeProvider`, and `KnowledgeSyncService`.
- Constructed the Chatwoot Help Center client only for the Chatwoot knowledge source; local mode uses a non-networking client and the worker does not start sync.
- Added awaitable sync startup so the worker waits for the initial sync attempt before starting receipt processing.
- Worker initialization order is receipt store, operational store, knowledge store, initial knowledge sync, then receipt worker.
- Worker shutdown stops knowledge sync before Redis and PostgreSQL pool shutdown.
- Initial Chatwoot sync failures are logged and do not prevent worker startup.
- Passed the knowledge provider through `processReceipt` into the AI post-inbound hook.
- Initialized the knowledge schema in the web runtime lifecycle as well.

## Verification

Focused lifecycle tests cover runtime construction, store/sync ordering, initial-sync failure continuation, local-mode sync suppression, shutdown ordering, and provider pass-through. Full command results are recorded in the implementation session and commit review.

## Known limitations

- This task does not deploy or alter Railway/GitHub configuration.
- The existing worker entrypoint is guarded so importing it for lifecycle tests does not execute the process main function; production execution remains through the compiled `worker.js` entrypoint.
- The Chatwoot sync service intentionally retains its existing periodic retry behavior and does not add backoff beyond the configured interval.
- Live Chatwoot, OpenAI, Telnyx, and PostgreSQL service behavior remains environment-gated and is not exercised by unit/fake tests.
