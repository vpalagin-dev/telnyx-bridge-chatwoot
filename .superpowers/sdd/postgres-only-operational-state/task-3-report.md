# Task 3 Report — Remove SQLite from configuration, runtime, and tests

## Implemented

- Removed `src/db/store.ts` and all runtime/test imports of `BridgeStore` and `node:sqlite`.
- Made `DATABASE_URL` mandatory for every runtime role; removed `DATABASE_PATH` and `PERSISTENCE_MODE` configuration.
- Updated `BridgeConfig` to expose `databaseUrl` plus Redis settings without persistence mode compatibility.
- Added worker-only Redis validation and explicit web/worker runtime-role guards.
- Rewired web and worker runtime composition to create one shared `pg.Pool`, pass it to `PostgresStore` and `PostgresOperationalStore`, initialize both stores, and close the pool once.
- Replaced SQLite test dependencies with an explicit in-memory `FakeOperationalStore`; PostgreSQL integration suites remain environment-gated.
- Preserved Redis dispatch/recovery behavior; no Redis crash semantics were changed.

## Verification

- `npm exec vitest -- run tests/unit/config.test.ts tests/integration/runtime.test.ts`: focused config suite passed (the repository has no `tests/integration/runtime.test.ts`; Vitest ran the existing config target).
- `npm run typecheck`: passed.
- `npm test`: passed — 119 passed, 26 skipped (145 total); PostgreSQL integration tests were skipped because no disposable test database was configured.
- `npm run build`: passed.
- Forbidden-reference search across source/tests/package (`BridgeStore`, `node:sqlite`, `DATABASE_PATH`, `PERSISTENCE_MODE`, `persistence.mode`, `databasePath`, `EOF`): no matches.

## Skips

- `tests/integration/persistence/postgres-store.test.ts`: 12 tests skipped without the disposable PostgreSQL test environment.
- `tests/integration/persistence/postgres-operational-store.test.ts`: 7 tests skipped without the disposable PostgreSQL test environment.
- Existing live Chatwoot/OpenAI tests remain environment-gated; no live provider actions were run.
