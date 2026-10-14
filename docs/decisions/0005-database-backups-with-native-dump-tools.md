# Decision 0005: Database backups with native dump tools

- Status: accepted
- Date: 2026-10-14

## Context

Teams using the toolkit need to back up a client's production database, starting from nothing but its connection URL, before deploying changes that migrate it. The first case is a PostgreSQL 16 database. The toolkit runs both on a developer's machine and as a deployed API, and the Database page is meant to host more database tools later.

## Decision

Back up by running each engine's own dump tool as a child process of a durable job, and keep everything engine-specific behind one adapter per engine.

- PostgreSQL is the only engine. Its adapter runs `pg_dump --format=custom` and checks the result with `pg_restore --list`.
- Connections are saved per organization with the URL encrypted by the existing AES-256-GCM helper and key. The helper moved from `@repo/shopify` to `@repo/security` so both features share it; `@repo/shopify/crypto` re-exports it unchanged.
- A backup is written to a temporary file, verified, then streamed into the configured storage provider. Storage gained `putObjectStream` and `getObjectStream` so no file is held in memory.
- Files are kept until someone deletes them.
- The `api-runner` image installs PostgreSQL client 18; developers install the client locally and may point `POSTGRES_CLIENT_BIN_DIR` at it.

## Alternatives rejected

| Approach | Why not |
|----------|---------|
| Run the dump tool through `docker run` with the engine's image | Picks the exact client version, but the deployed API container has no Docker socket. |
| Dump with a JavaScript driver | Re-implements what `pg_dump` does: ordering, sequences, extensions, ownership. A backup that looks successful but does not restore is the worst outcome for this feature. |

## What was verified

- `packages/database-tools/integration/backup.integration.test.ts` dumps a seeded database (tables in two schemas, a sequence, a foreign key, an index, a view), restores the archive into an empty database, and finds the same tables, row counts and sequence value. It also covers a rejected password, a client older than the server, an aborted backup, a second delivery of a finished job, and that no password reaches the backup row, audit log, job record or logs.
- `packages/api/integration/databases.integration.test.ts` covers the routes, permissions for Owner, Member, Viewer and a user from another organization, the download, and keeping backups after their connection is deleted.
- A 1.3 GB archive was backed up and downloaded through the app origin (`/api` rewrite) with flat memory in both the API and Next.js processes.
- While `pg_dump` runs, its process arguments are `--format=custom --no-password --file=<path>` only; the connection travels in `PG*` environment variables.
- The S3 stream upload was checked against an S3-compatible server: a multipart round trip with a matching hash, and a failed upload leaving no object and no open multipart upload. That check found that the SDK's default CRC32 checksum on multipart uploads makes the completion request fail, so the S3 client now sends checksums only when an operation requires one.

## Behaviour to know about

**The client must be at least the server's major version.** A backup checks this first and fails with both versions named. Keep the image's client at the newest available major.

**Restoring into an older server prints one harmless error.** A PostgreSQL 16 database was backed up with client 18 and restored with the documented commands into a 16 server; the data matched, but `pg_restore` 18 reports that the server does not know `transaction_timeout` and exits with status 1. The guide shows the exact message.

**Server-side connections reach the API's network.** A deployed API connects to whatever host a permitted user enters. There is no outbound allowlist; the exposure is limited by the `databases:manage` permission, which only Owners and Admins hold by default, and every connection and backup is audited. Revisit this before the toolkit serves organizations that are not trusted.

**Only `sslmode` is read from the URL.** Other parameters are dropped, because URLs written for an ORM carry ones the client tools reject. The connection check maps `sslmode` the way libpq does, so `require` does not verify the certificate, matching what `pg_dump` will do.

**Backups do not survive a restart.** A graceful shutdown stops the running dump and marks the backup failed. A crash gets one more attempt, which starts the dump over. At startup, backups that can no longer finish are marked failed so they do not keep their connection busy.

## Deferred

MySQL/MariaDB (`mysqldump`) and MongoDB (`mongodump`) adapters wait for a real need. The open questions for each are listed in [Database tools](../database.md#not-supported-yet).
