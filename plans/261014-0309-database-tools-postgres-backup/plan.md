---
title: "Database tools: connections and PostgreSQL backup"
description: "Add a Database page where an organization saves encrypted database connections and backs up a PostgreSQL database with pg_dump into toolkit storage."
status: completed
priority: P1
effort: 7d
branch: main
tags: [feature, backend, frontend, database, api, infra]
blockedBy: []
blocks: []
created: 2026-10-14
---

# Database tools: connections and PostgreSQL backup

## Overview

Add a Database page where an organization saves encrypted database connections and backs up a PostgreSQL database with `pg_dump` into toolkit storage. The page is the home for later database tools; the first tool is backup. The driving case is backing up the EVISU production database (PostgreSQL 16) before a deploy, starting from nothing but its connection URL.

Paths in phase files are relative to the repository root.

## Accepted Decisions

| Area | Decision |
|------|----------|
| Engines | PostgreSQL only in this plan. MySQL/MariaDB and MongoDB are deferred until there is a real need; see Deferred Work. |
| Engine boundary | One adapter per engine (recognise URL, test connection, dump, verify). Only the PostgreSQL adapter is written. |
| Dump method | Run the engine's own tool (`pg_dump -Fc`) as a child process. Rejected: `docker run` (no Docker socket in the deployed container) and a dump written with a JS driver (restores are not trustworthy). |
| Where it runs | Both a developer machine and the deployed API. The Postgres client is added to the `api-runner` image and documented for macOS. |
| Connections | Saved per organization, URL encrypted at rest. |
| Encryption | The existing AES-256-GCM helper moves from `@repo/shopify` to `@repo/security` and keeps `SHOPIFY_TOKEN_ENCRYPTION_KEY`, so there is one key to back up. |
| Backup files | Written to the configured storage provider (local or S3/R2) and downloadable from the browser. |
| Retention | Kept until a user deletes them. No automatic expiry. |
| Access | New `databases` permission module, granted to Owner and Admin by default; Member and Viewer get nothing. |

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Save, check and delete database connections from a pasted URL, with the URL encrypted | P1 |
| 2 | Back up a PostgreSQL database in the background, verify the archive, store it and download it | P1 |
| 3 | Run the same way on a developer machine and in the deployed API image | P1 |
| 4 | Keep credentials out of logs, audit records, job rows and process arguments | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Runtime Tooling and Shared Crypto](./phase-01-runtime-tooling-and-shared-crypto.md) | Pending |
| 2 | [Phase 2: Storage Streaming](./phase-02-storage-streaming.md) | Pending |
| 3 | [Phase 3: Connections Data Model and Service](./phase-03-connections-data-model-and-service.md) | Pending |
| 4 | [Phase 4: Backup Engine and Job](./phase-04-backup-engine-and-job.md) | Pending |
| 5 | [Phase 5: API Contracts and Download](./phase-05-api-contracts-and-download.md) | Pending |
| 6 | [Phase 6: Database UI](./phase-06-database-ui.md) | Pending |
| 7 | [Phase 7: Docs and Release Check](./phase-07-docs-and-release-check.md) | Pending |

Phases 1 and 2 are independent of each other. Phase 3 needs 1. Phase 4 needs 1, 2 and 3. Phase 5 needs 4. Phase 6 needs 5. Phase 7 needs all.

## Non-Goals

- Restoring from the UI. The docs give the `pg_restore` command to run by hand.
- Scheduled backups, a query console, a schema browser, SSH tunnel management.
- MySQL/MariaDB and MongoDB adapters.
- An outbound-network allowlist. See Threat Model.

## Threat Model

- **What is stored:** connection URLs with passwords (encrypted with the shared key), and backup archives that contain full production data.
- **Who can reach it:** only members holding `databases` permissions. Archive downloads re-check the permission on every request and are audited.
- **Server-side connections:** the deployed API connects to whatever host a permitted user enters, so that user can make the API reach hosts on its own network. The repository has no outbound filter today. This plan limits the exposure with the Owner/Admin-only permission and an audit record per connection and backup, and does not add an allowlist. Revisit before the toolkit is opened to untrusted organizations.
- **Leak paths closed by design:** the password is passed to `pg_dump` through the child's environment, never its arguments; the child gets a minimal environment, not the API's; job payloads carry a backup id only; tool output is redacted before it is stored or logged.

## Success Criteria

- [x] A valid PostgreSQL URL saves as a connection; a malformed or unreachable one fails with a clear message that contains no password. (connections integration tests and the API test (422 without the password))
- [x] Starting a backup produces a `.dump` archive, and the job runs `pg_restore --list` on it before reporting success. (`runBackup` verifies before upload; restore test)
- [x] An integration test restores an archive into an empty database and finds the same tables and row counts as the source. (`backup.integration.test.ts`)
- [x] Writing an archive larger than available memory completes, because nothing buffers the whole file. (256 MB local stream test with flat memory; 1.3 GB backup and download)
- [x] A user without `databases` permissions cannot see connections, start a backup or download an archive. (API test (Member and Viewer 403, outsider 404) and browser test)
- [x] No URL or password appears in logs, audit records, job rows or the process list. (secret scans in both integration suites; process list checked during a real dump)
- [x] A `pg_dump` older than the server fails the backup with a clear message and leaves no partial archive. (version-mismatch integration test)
- [x] The `api-runner` image contains `pg_dump` and `pg_restore`, and `pnpm release:check` passes. (image built and booted directly; release check passes; `pnpm docker:validate` passes after fixing its pre-existing job-provider gap)
- [x] `docs/database.md` covers connecting, backing up, restoring by hand, installing the client locally and the deferred engines; `docs/README.md` and `docs/architecture.md` are updated. (all commands run; links checked)

## Deferred Work

Recorded here so it is picked up when a real need appears, not built now.

| Item | What is known |
|------|---------------|
| MySQL / MariaDB adapter | Tool is `mysqldump --single-transaction`, output gzip-compressed SQL. Alpine ships the MariaDB client, which differs from the MySQL 8 client in places; test against the actual server before relying on it. |
| MongoDB adapter | Tool is `mongodump --archive --gzip`. Availability of `mongodb-tools` on the Alpine release behind `node:24-alpine` has not been checked; if it is missing the API image may need a Debian base. |

## Evidence Checked While Planning

- `node:24-alpine` is Alpine 3.24.2 and offers `postgresql16-client`, `postgresql17-client` and `postgresql18-client` (checked with `apk search` in the image on 2026-10-14).
- The developer machine has Docker but no `pg_dump`.
- The toolkit's own database and CI service are `postgres:17-alpine`; the EVISU reference project uses `postgres:16`.
- `StorageProvider.putObject` and `getObject` take and return a whole `Uint8Array`.
- `@repo/security` exists, is empty, and is already an allowed import for `@repo/api`.

## Implementation Notes

Recorded during implementation on 2026-10-14; the phase files keep the original plan.

- **S3 checksums.** The S3 stream check found that the SDK opens multipart uploads with a CRC32 checksum that `lib-storage` does not complete, and the server rejects the upload. Upgrading the SDK did not fix it. The S3 client now sends checksums only when an operation requires one (`requestChecksumCalculation: "WHEN_REQUIRED"`).
- **Extra route.** `databaseBackups.listForOrganization` was added so backups of deleted connections, which are kept, stay visible and downloadable.
- **Permission-aware UI.** The connection page checks permissions on the server, like the flow builder. The list page relies on the API's no-permission message, like the stores page, because the app has no endpoint for the current member's permissions.
- **Turbo and CI.** `POSTGRES_CLIENT_BIN_DIR` and `DATABASE_BACKUP_TMP_DIR` are declared in `turbo.json`; without them turbo hid the client path from tests and from `pnpm dev`. CI installs client 18 and runs the database tools integration tests.
- **Restore into PostgreSQL 16.** `pg_restore` 18 prints one harmless `transaction_timeout` error and exits with status 1 against a 16 server; the data is complete. Documented in `docs/database.md`.
- **Large download.** A 1.3 GB archive was backed up in 79 s and downloaded through the app origin with flat memory in both processes, so no fallback was needed.

## Open Questions

- Resolved: CI installs client 18 explicitly; the install steps were rehearsed in an Ubuntu 24.04 container.
- Resolved: the Next.js `/api/:path*` rewrite streams a 1.3 GB download without buffering.
