# Task 1 Report — OperationalStore contract

## Status

Implemented the persistence-neutral `OperationalStore` contract and refactored the inbound, outbound, AI, rate-limit, and Telnyx AI dispatch pipelines to consume it. No PostgreSQL schema changes were made and SQLite was not removed.

## Changed files

- `src/persistence/operational-store.ts`
  - Added the persistence-neutral contract covering event claims/status, suppression, conversation bindings, outbound action state, AI decision lifecycle, AI history, AI conversation state, and AI reply rate-limit operations.
  - Imports only domain AI types; it does not import `BridgeStore`, `DatabaseSync`, `node:sqlite`, or other SQLite-specific types.
- `src/inbound/process-inbound.ts`
- `src/outbound/process-outbound.ts`
- `src/ai/process-ai.ts`
- `src/ai/rate-limit.ts`
- `src/ai/telnyx-dispatch.ts`
  - Replaced `BridgeStore` dependency type imports with `OperationalStore`.
- `tests/unit/persistence/operational-store-contract.test.ts`
  - Added a SQLite-free fake implementation and contract coverage for duplicate event/action/AI claims plus suppression, debounce, and quota denials.

## Verification

- `npm exec vitest -- run tests/unit/persistence/operational-store-contract.test.ts`
  - `1` test file passed; `2` tests passed.
- `npm run typecheck`
  - `tsc -p tsconfig.json --noEmit` exited successfully with no diagnostics.

## Concerns

- The contract is synchronous because the current `BridgeStore` and pipeline methods are synchronous. A PostgreSQL implementation will need to preserve these pipeline-facing semantics or introduce an explicitly async follow-up contract.
- `BridgeStore` remains the runtime implementation and still owns SQLite schema/lifecycle; this task intentionally does not replace it.
- Existing workspace contains unrelated untracked Superpowers/spec artifacts; only Task 1 files are included in the commit.

## Commit

`refactor(persistence): define postgres operational store contract`
