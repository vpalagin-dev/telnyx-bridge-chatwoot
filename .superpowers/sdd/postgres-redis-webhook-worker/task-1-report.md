# Task 1 Report: PostgreSQL and Redis Runtime Configuration

## Summary

Implemented Task 1 from `docs/superpowers/plans/2026-10-05-postgres-redis-webhook-worker.md` without changing runtime processing behavior. SQLite remains the default persistence mode for existing local/test configurations; `postgres_redis` requires both connection URLs.

No Railway secret values or production credentials were used, copied, logged, or committed.

## Files changed

- `.env.example`
  - Added `PERSISTENCE_MODE`, `DATABASE_URL`, `REDIS_URL`, `BRIDGE_REDIS_PREFIX`, and `RUNTIME_ROLE`.
  - Kept `DATABASE_PATH` for SQLite local/test use.
- `package.json`
  - Added `pg: ^8.13.1`.
  - Added `redis: ^4.7.0`.
- `package-lock.json`
  - Locked the new dependency tree.
- `src/config/env.ts`
  - Added parsing/defaults for persistence mode, PostgreSQL URL, Redis URL, Redis prefix, and runtime role.
  - Added `BridgeConfig.persistence` and `BridgeConfig.runtimeRole`.
  - Added validation requiring `DATABASE_URL` and `REDIS_URL` in `postgres_redis` mode.
  - Preserved SQLite defaults and existing validation behavior.
- `tests/unit/config.test.ts`
  - Added tests for default SQLite configuration, PostgreSQL/Redis production settings, missing URL rejection, custom Redis prefix, worker role, and SQLite URL omission.
- `tests/integration/ai/conversation-policy.test.ts`
- `tests/integration/ai/fake-smoke.test.ts`
- `tests/integration/webhooks.test.ts`
- `tests/unit/runtime.test.ts`
  - Updated typed test fixtures to include the newly required `BridgeConfig` fields; runtime behavior is unchanged.

## TDD and verification output

### RED: failing tests before implementation

Command:

```powershell
npm exec vitest -- run tests/unit/config.test.ts
```

Result: expected failure, `5 failed | 10 passed`.

The failures showed that `config.persistence` and `config.runtimeRole` were not present and that missing PostgreSQL/Redis URLs were not rejected.

### GREEN: targeted configuration tests

Command:

```powershell
npm exec vitest -- run tests/unit/config.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       15 passed (15)
```

### Typecheck

Command:

```powershell
npm run typecheck
```

Result: exit code 0; TypeScript completed without errors.

### Full test suite

Command:

```powershell
npm test
```

Result:

```text
Test Files  19 passed (19)
Tests       96 passed | 1 skipped (97)
```

The skipped test is the existing local/live Chatwoot test skip; no new skips were introduced.

## Concerns and follow-up notes

- `npm install` reported one moderate audit vulnerability and an existing npm pending install-script approval warning. This task did not run an audit remediation because that would be unrelated dependency behavior.
- The dependency ranges in `package.json` are the exact ranges requested by the plan (`^8.13.1` and `^4.7.0`); npm resolved compatible current lockfile versions.
- `.env.example` was ignored by the repository ignore rules, so it was explicitly force-added as required by the task.
- Validation is applied whenever `PERSISTENCE_MODE=postgres_redis` is selected, including test environments; SQLite remains the default when the mode is omitted.

## Commit

Focused implementation commit:

```text
e2b35f50bc85d575cd48d805b7396a25147a12d0
```

Commit message:

```text
feat(storage): configure postgres and redis runtime
```

The report itself is intentionally separate from the focused implementation commit so the implementation hash recorded above remains stable.
