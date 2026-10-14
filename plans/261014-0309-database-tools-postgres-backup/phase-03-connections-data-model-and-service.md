---
phase: 3
title: "Phase 3: Connections Data Model and Service"
status: todo
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 3: Connections Data Model and Service

## Context Links

- Schema: `packages/database/prisma/schema.prisma` (pattern: `ShopifyStore`, `AuditLog`)
- Permissions: `packages/access-control/src/catalog.ts`, `packages/access-control/src/roles.ts`, `packages/access-control/src/access-control.test.ts`
- Role sync for existing organizations: `packages/database/src/sync-all-system-roles.ts` (`pnpm db:sync-roles`)
- Audit pattern: `packages/shopify/src/stores/audit.ts`
- Package layout to copy: `packages/flows/package.json`, `packages/shopify/src/stores/`
- Import rules: `boundaries.config.json`

## Overview

Create the `@repo/database-tools` package, the tables for connections and backups, the `databases` permissions, and the service that turns a pasted URL into a checked, encrypted connection.

## Key Insights

- `@repo/database` is the Prisma package, so the new package is named `@repo/database-tools` to avoid confusion.
- `VIEWER_PERMISSIONS` is built from every catalog entry whose action is `read`. A `databases:read` entry would reach Viewers unless that module is excluded, and the accepted decision is Owner and Admin only.
- Database URLs written for Prisma carry parameters libpq does not accept, such as `?schema=public` or `connection_limit`. The EVISU project uses Prisma, so its URL will likely have them. Unknown parameters must be dropped, not passed on.
- The `pg` driver treats `sslmode=require` more strictly than libpq does (it verifies the certificate). Managed databases with a private CA would then pass `pg_dump` but fail the connection test. The test must follow libpq's meaning.
- `pg` is already a dependency of `@repo/database` and `@repo/jobs` at `^8.22.0`.

## Requirements

- Tables `database_connection` and `database_backup`, both scoped to an organization.
- Permissions `databases:read`, `databases:manage`, `databases:backup` for Owner and Admin; none for Member or Viewer.
- An engine adapter interface with one implementation, PostgreSQL.
- Connection service: create, list, get, update (name and/or URL), check, delete.
- The URL is stored only encrypted. Host, port, database name and username are stored in clear for display.
- A connection with a queued or running backup cannot be deleted. Deleting a connection keeps its finished backups.
- Every create, update and delete writes an audit record without the URL.

## Architecture

Data model (Prisma):

```prisma
enum DatabaseEngine { POSTGRESQL }
enum DatabaseBackupStatus { QUEUED RUNNING COMPLETED FAILED }

model DatabaseConnection {
  id              String         @id @default(cuid())
  organizationId  String
  name            String
  engine          DatabaseEngine
  urlEncrypted    String         @db.Text
  host            String
  port            Int
  databaseName    String
  username        String
  serverVersion   String?
  lastCheckedAt   DateTime?
  lastCheckError  String?        @db.Text
  createdById     String?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  // relations: organization (Cascade), backups
  @@unique([organizationId, name])
  @@map("database_connection")
}

model DatabaseBackup {
  id              String               @id @default(cuid())
  organizationId  String
  connectionId    String?              // SetNull when the connection is deleted
  connectionName  String               // snapshot, survives connection deletion
  engine          DatabaseEngine
  databaseName    String
  status          DatabaseBackupStatus @default(QUEUED)
  storageProvider String?
  objectKey       String?
  fileName        String?
  sizeBytes       BigInt?
  checksumSha256  String?
  toolVersion     String?
  serverVersion   String?
  error           String?              @db.Text
  requestedById   String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime             @default(now())
  @@index([organizationId, createdAt])
  @@index([connectionId, createdAt])
  @@map("database_backup")
}
```

Engine adapter (`packages/database-tools/src/engines/types.ts`):

```ts
interface ParsedDatabaseUrl {
  databaseName: string;
  host: string;
  password: string;
  port: number;
  sslMode?: string;
  username: string;
}
interface DatabaseEngineAdapter {
  engine: "POSTGRESQL";
  /** URL schemes this adapter owns, e.g. "postgresql", "postgres". */
  schemes: readonly string[];
  parseUrl(url: string): ParsedDatabaseUrl;
  /** Connects, reads the server version, disconnects. */
  check(target: ParsedDatabaseUrl): Promise<{ serverVersion: string }>;
  // dump and verify are added in phase 4
}
```

`resolveAdapter(url)` picks the adapter by scheme and throws a typed "unsupported engine" error naming the scheme for anything else, including `mysql:` and `mongodb:`.

PostgreSQL URL handling:

- Accept `postgresql:` and `postgres:`. Require host, database name and username. Default port 5432. Percent-decode username and password.
- Keep `sslmode` only. Drop every other query parameter.
- Connection test uses `pg` with a 10 second connect timeout and runs `SHOW server_version`. Map `sslmode`: `disable` to no TLS; `require` and `prefer` to TLS without certificate verification; `verify-ca` and `verify-full` to TLS with verification.

Errors: a `DatabaseToolsError` with codes (`INVALID_URL`, `UNSUPPORTED_ENGINE`, `CONNECTION_FAILED`, `NAME_TAKEN`, `CONNECTION_BUSY`, `NOT_FOUND`). `CONNECTION_FAILED` carries the driver's message passed through a redactor that removes the password and any URL.

## Related Code Files

- Modify: `packages/database/prisma/schema.prisma` plus a new migration under `packages/database/prisma/migrations/`
- Modify: `packages/access-control/src/catalog.ts`, `packages/access-control/src/roles.ts`, `packages/access-control/src/access-control.test.ts`
- Create: `packages/database-tools/package.json`, `tsconfig.json`
- Create: `packages/database-tools/src/index.ts`, `errors.ts`, `redact.ts`, `audit.ts`
- Create: `packages/database-tools/src/engines/types.ts`, `engines/index.ts`, `engines/postgres/url.ts`, `engines/postgres/check.ts`, `engines/postgres/index.ts`
- Create: `packages/database-tools/src/connections/connection-repository.ts`, `connections/connections.ts`
- Create: tests beside each of `redact.ts`, `engines/postgres/url.ts`, `engines/index.ts`
- Create: `packages/database-tools/integration/connections.integration.test.ts`
- Modify: `boundaries.config.json` (`@repo/database-tools` may import `@repo/database`, `@repo/jobs`, `@repo/logger`, `@repo/security`, `@repo/storage`; no client-safe entry points; add it to `@repo/api`'s list)

## Implementation Steps

1. Add the enums and models, relate them to `Organization` and `User`, and create the migration with `pnpm db:migrate:dev`.
2. Add the three catalog entries. Exclude the `databases` module from `VIEWER_PERMISSIONS`. Leave `MEMBER_PERMISSIONS` unchanged. Update the access-control tests to assert Owner and Admin have all three and Member and Viewer have none.
3. Run `pnpm db:sync-roles` locally and confirm existing organizations' Owner and Admin roles gain the permissions. If the sync does not add new catalog entries to existing roles, extend it so it does.
4. Scaffold the package following `packages/flows` (source-only build script, `test`, `test:unit`, `test:integration` scripts) and add the boundary rule.
5. Write the redactor: given the known password and URL, replace every occurrence in a string; also mask anything shaped like `scheme://user:secret@`.
6. Write the PostgreSQL URL parser and connection check as described.
7. Write the repository and service. `create` and `update` run the check first and refuse to save a connection that cannot be reached. `check` updates `serverVersion`, `lastCheckedAt` and `lastCheckError`.
8. Write the audit helper with actions `database.connection.created`, `.updated`, `.deleted` (backup actions are added in phases 4 and 5). Metadata holds name, engine, host and database name only.
9. Unit tests: URL parsing (both schemes, default port, encoded password, dropped Prisma parameters, missing parts, unsupported scheme), redaction.
10. Integration test against the test Postgres: create with the real `DATABASE_URL`, list, check, rename, duplicate name rejected, wrong password rejected with a message that does not contain the password, delete. Assert the stored row's `urlEncrypted` does not contain the password.

## Todo

- [x] Models and migration
- [x] Permissions added, Viewer excluded, tests updated
- [x] Role sync verified for existing organizations
- [x] Package scaffolded and boundary rule added
- [x] Redactor
- [x] PostgreSQL URL parser and connection check
- [x] Repository and service
- [x] Audit helper
- [x] Unit tests
- [x] Integration test

## Success Criteria

- `pnpm --filter @repo/database-tools test` and `test:integration` pass.
- `pnpm --filter @repo/access-control test` passes with the new role expectations.
- `pnpm boundaries`, `pnpm check-types` and `pnpm db:migrate:status` are clean.

## Risk Assessment

- **A production URL has a parameter the parser drops but the server needs.** Only `sslmode` is kept on purpose. If a real URL needs another libpq parameter, add it to the kept list by name with a test.
- **Role sync does not reach existing organizations.** Step 3 checks this before any UI depends on it.

## Security Considerations

- The URL is decrypted only inside the service, at the moment of a check or a backup, and never returned by any function the API exposes.
- Error messages from the driver can echo the connection string; every one passes through the redactor.
- A connection check makes the server open a TCP connection to a user-supplied host. See the plan's Threat Model.

## Next Steps

Phase 4 adds `dump` and `verify` to the adapter and the backup service on top of these tables.
