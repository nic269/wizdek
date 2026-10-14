---
phase: 7
title: "Phase 7: Docs and Release Check"
status: todo
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3, 4, 5, 6]
---

# Phase 7: Docs and Release Check

## Context Links

- Docs index: `docs/README.md`
- Architecture: `docs/architecture.md`
- Guide to match in tone and structure: `docs/stores.md`
- Decision records: `docs/decisions/`
- Root setup instructions: `README.md`

## Overview

Document the feature for the people who will use and operate it, record the durable decisions, and prove the whole change with the release check and one real backup.

## Requirements

`docs/database.md` covers:

- What a connection is, which engines are supported (PostgreSQL), and the permissions involved.
- Adding a connection from a URL, including the note that `localhost` refers to the machine the API runs on, and that parameters other than `sslmode` are ignored.
- Running a backup, what the statuses mean, where the file is stored, and that files are kept until deleted.
- Restoring by hand: `pg_restore --list` to inspect, and a `pg_restore --clean --if-exists --no-owner --dbname=...` example into a target database, with a warning that restore overwrites data and should be rehearsed on a non-production database first.
- Operating notes: the client must be at least as new as the server; installing the client on macOS and setting `POSTGRES_CLIENT_BIN_DIR`; temporary disk space equal to the archive size and `DATABASE_BACKUP_TMP_DIR`; in a deployed container, local storage must be a persistent volume or backups are lost on redeploy, so S3 or R2 is recommended there; a dump blocks schema changes on the source while it runs; archives contain production data and are not encrypted by the toolkit beyond what the storage provider does; `SHOPIFY_TOKEN_ENCRYPTION_KEY` now also protects database URLs.
- Deferred engines: MySQL/MariaDB and MongoDB, with what is known from the plan.

Also:

- `docs/README.md`: add the guide and the decision record to the table.
- `docs/architecture.md`: add `@repo/database-tools`, the move of secret encryption to `@repo/security`, and the stream methods on storage.
- `docs/stores.md`: update the sentence about `SHOPIFY_TOKEN_ENCRYPTION_KEY` so it mentions database connections.
- `docs/decisions/0005-database-backups-with-native-dump-tools.md`: the decision, the alternatives rejected and why, the server-side connection threat model, and the deferred engines.
- Root `README.md`: mention the Postgres client as a local prerequisite if it lists prerequisites.

## Related Code Files

- Create: `docs/database.md`, `docs/decisions/0005-database-backups-with-native-dump-tools.md`
- Modify: `docs/README.md`, `docs/architecture.md`, `docs/stores.md`, `README.md`

## Implementation Steps

1. Read each document before changing it and match its structure.
2. Write the guide and the decision record from what was built, not from this plan. Check every command, env var name, permission name and route against the source.
3. Run every command the guide tells a reader to run, including the macOS install and the restore example against a scratch database.
4. Run `pnpm release:check` and `pnpm test:integration`.
5. Run `pnpm docker:validate`.
6. Real-use check on the developer machine: add a connection to a PostgreSQL 16 database (a local `postgres:16` container is enough to stand in for EVISU), back it up from the UI, download it, and restore it into an empty database with the documented command.
7. Compare the result with every item under Success Criteria in `plan.md` and tick each one with the evidence that proves it.

## Todo

- [x] `docs/database.md`
- [x] Decision record 0005
- [x] Index, architecture, stores guide and root README updated
- [x] Every documented command run once
- [x] `pnpm release:check` and `pnpm test:integration` pass
- [x] `pnpm docker:validate` passes. It had failed since pg-boss became required in production (commit b66a257), because the script started the API without a database or job provider; the script now runs a Postgres container and sets `JOBS_PROVIDER=pgboss`.
- [x] Real-use backup and restore of a PostgreSQL 16 database (through the service and job against a `postgres:16` container, restored with the documented commands)
- [x] Plan success criteria ticked with evidence

## Success Criteria

- All three commands in step 4 and 5 exit zero.
- A person following only `docs/database.md` can add a connection, back it up and restore the file.
- Every link in the changed documents resolves.

## Risk Assessment

- **Docs drift from the implementation.** Step 2 and 3 tie every claim to source or a command that was run.

## Security Considerations

- Examples use placeholder hosts and credentials, never a real URL.

## Next Steps

After this phase the plan is ready to close. The first real use is the EVISU production backup; do one rehearsal against a non-production copy first and confirm the archive restores.
