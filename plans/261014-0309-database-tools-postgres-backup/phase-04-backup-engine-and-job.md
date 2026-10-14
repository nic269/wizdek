---
phase: 4
title: "Phase 4: Backup Engine and Job"
status: todo
priority: P1
effort: "1.5d"
dependencies: [1, 2, 3]
---

# Phase 4: Backup Engine and Job

## Context Links

- Job contract: `packages/jobs/src/types.ts` (`JobDefinition`: `timeoutSeconds`, `heartbeatSeconds`, `serialPerKey`, `retry`, handler `signal`)
- Job pattern to copy: `packages/flows/src/engine/run-job.ts`
- Durable-job behaviour: `docs/decisions/0004-durable-jobs-on-pg-boss.md`
- Storage keys: `buildTenantObjectKey` in `packages/storage/src/provider.ts`
- Tools and env from phase 1; stream storage from phase 2; tables and adapter from phase 3

## Overview

Run `pg_dump` as a child process inside a durable job, verify the archive, store it, and record the outcome.

## Key Insights

- libpq reads the target from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and `PGSSLMODE`. That keeps the password out of the argument list, which any local user can read with `ps`.
- Writing the archive to a local temporary file first, then verifying it, then uploading it, means a failed or unreadable dump never reaches storage. It costs temporary disk space equal to the archive size.
- `pg_dump -Fc` is already compressed and is the format `pg_restore` can restore selectively.
- `pg_dump` takes only `ACCESS SHARE` locks, so it does not block reads or writes on the source, but it does block schema changes for its duration.
- A durable job whose process dies is delivered again. The handler must be safe to run twice for the same backup.

## Requirements

- Adapter gains `toolVersion()`, `dump()` and `verify()`.
- Before dumping, compare the tool's major version with the server's. If the tool is older, fail with a message naming both versions and write nothing.
- The child process receives only `PATH`, the `PG*` variables and locale; never the API's environment.
- Captured tool output is limited to its last few kilobytes and redacted before it is stored or logged.
- On success the backup row has provider, key, file name, size, SHA-256, tool version and server version.
- On failure or abort the temporary file is removed, nothing is left in storage, and the row is `FAILED` with a redacted reason.
- At most one backup runs per connection at a time.

## Architecture

Adapter additions:

```ts
interface DatabaseEngineAdapter {
  /* phase 3 members */
  fileExtension: string;                         // "dump"
  contentType: string;                           // "application/octet-stream"
  toolVersion(): Promise<{ major: number; text: string }>;
  dump(input: { target: ParsedDatabaseUrl; outputPath: string; signal: AbortSignal }): Promise<void>;
  verify(input: { path: string; signal: AbortSignal }): Promise<void>;
}
```

PostgreSQL:

- `dump`: `pg_dump --format=custom --no-password --file=<outputPath>` with the `PG*` environment. `--no-password` makes a missing or wrong password fail instead of waiting on a prompt.
- `verify`: `pg_restore --list <path>`; a zero exit with a non-empty listing passes.
- Tool lookup: `POSTGRES_CLIENT_BIN_DIR` when set, otherwise `PATH`. A missing tool raises `TOOL_NOT_FOUND` with install guidance.
- A shared `runTool()` helper spawns without a shell, wires the abort signal to `SIGTERM` (then `SIGKILL` after a grace period), keeps a bounded tail of stderr, and rejects with the redacted tail on a non-zero exit.

Backup service (`packages/database-tools/src/backups/`):

- `startBackup({ connectionId, organizationId, actorId }, jobs)`: creates a `QUEUED` row with the name snapshot, enqueues `database.backup` with payload `{ backupId }` and `concurrencyKey` equal to the connection id, writes audit `database.backup.started`.
- `listBackups`, `getBackup`, `deleteBackup` (removes the stored object, then the row; refuses while `QUEUED` or `RUNNING`; audit `database.backup.deleted`).

Job (`createDatabaseBackupJob()`), `serialPerKey: true`, heartbeat set, timeout 12 hours, one attempt:

1. Load the backup. If it is `COMPLETED` or `FAILED`, return (second delivery). If its connection is gone, mark `FAILED`.
2. Mark `RUNNING`, set `startedAt`. Decrypt the URL, parse it.
3. Read tool and server versions; apply the version rule.
4. Dump to `<tmp>/<backupId>.dump`, where `<tmp>` is `DATABASE_BACKUP_TMP_DIR` or the OS temp directory. A leftover file from an earlier delivery is overwritten.
5. Verify the file.
6. Stream the file to storage with `putObjectStream`, computing SHA-256 in a pass-through. Key: `buildTenantObjectKey` with the organization id and file name `<connection-name>-<UTC timestamp>.dump`.
7. Mark `COMPLETED` with metadata. In `finally`, remove the temporary file.
8. On any error or abort: remove a stored object if the upload had finished, mark `FAILED` with the redacted reason, and return normally so the queue does not redeliver a backup that failed for a real reason.

## Related Code Files

- Modify: `packages/database-tools/src/engines/types.ts`, `engines/postgres/index.ts`
- Create: `packages/database-tools/src/engines/run-tool.ts`, `engines/postgres/dump.ts`, `engines/postgres/env.ts`
- Create: `packages/database-tools/src/backups/backup-repository.ts`, `backups/backups.ts`, `backups/backup-job.ts`
- Create: `packages/database-tools/src/keys.ts` (`POSTGRES_CLIENT_BIN_DIR`, `DATABASE_BACKUP_TMP_DIR`)
- Modify: `packages/database-tools/src/audit.ts`, `src/index.ts`, `src/errors.ts`
- Create: unit tests beside `run-tool.ts` and `engines/postgres/env.ts`
- Create: `packages/database-tools/integration/backup.integration.test.ts`
- Modify: `.env.example` (`DATABASE_BACKUP_TMP_DIR`)

## Implementation Steps

1. Write `runTool()` and unit-test it with small real commands: success, non-zero exit with stderr tail, abort kills the child, the child's environment contains only what was passed.
2. Write the `PG*` environment builder and test it, including that the password never appears in the argument array.
3. Implement `toolVersion`, `dump` and `verify` for PostgreSQL.
4. Write the repository and the service functions.
5. Write the job handler following the eight steps above.
6. Integration test, using scratch databases created on the test server and dropped afterwards:
   - Seed a source database with several tables, a sequence, a foreign key, an index and a view, with known row counts.
   - Start a backup through the service with a job provider that runs handlers, wait for `COMPLETED`.
   - Read the stored object, restore it with `pg_restore` into an empty database, and compare table names and row counts with the source.
   - Assert the stored SHA-256 and size match the object.
   - Assert no password or URL appears in the backup row, the audit rows, the job payload or captured log output.
   - Wrong password: the backup ends `FAILED`, nothing is in storage, no temporary file remains, and the stored reason does not contain the password.
   - Tool older than server: with a version probe injected to report an older major, the backup ends `FAILED` with a message naming both versions and `pg_dump` is never spawned.
   - Abort mid-dump: aborting the handler's signal ends in `FAILED` with no stored object and no temporary file.
   - Second delivery of a completed backup returns without dumping again.
7. If `pg_dump` is not installed where the integration test runs, the test fails with the install instruction from `docs/database.md`. It does not skip.

## Todo

- [x] `runTool()` with tests
- [x] `PG*` environment builder with tests
- [x] PostgreSQL `toolVersion`, `dump`, `verify`
- [x] Backup repository and service
- [x] Job handler
- [x] Integration test: restore and compare
- [x] Integration tests: failure, version mismatch, abort, redelivery, secret scan
- [x] `.env.example` updated

## Success Criteria

- `pnpm --filter @repo/database-tools test` and `test:integration` pass locally and in CI.
- The restore comparison proves an archive produced by the job restores to the same tables and row counts.
- While a dump runs, `ps -o args` for the child shows no password and no URL.

## Risk Assessment

- **Temporary disk fills up on a large database.** `pg_dump` exits non-zero, the job fails cleanly and removes the file. `DATABASE_BACKUP_TMP_DIR` lets the operator point at a larger volume. Document the space requirement.
- **A backup outlives the 12 hour timeout.** The signal aborts the child and the row is marked failed. The value is one constant; raise it up to the provider's 24 hour cap if a real database needs it.
- **The API restarts mid-backup.** The job is delivered again after the heartbeat lapses and starts over from an empty file. If shutdown is graceful, the abort path marks it failed instead and the user starts it again.
- **`JOBS_PROVIDER=local` in development.** The in-memory provider runs the handler in-process; a restart loses the job and leaves a row `RUNNING`. Add a startup sweep in the job registration that marks `RUNNING` rows older than the timeout as failed, so a stale row cannot block deleting its connection forever.

## Security Considerations

- Password only in the child's environment; child environment built from an allowlist.
- No shell is involved in spawning; the connection name is used only in the storage file name, after `sanitizeObjectKeySegment`.
- Archives are not encrypted by the toolkit. S3 objects get server-side encryption; local files rely on disk permissions. Stated in the docs.

## Next Steps

Phase 5 exposes the services through the API and registers the job.
