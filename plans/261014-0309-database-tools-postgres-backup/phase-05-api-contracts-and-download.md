---
phase: 5
title: "Phase 5: API Contracts and Download"
status: todo
priority: P1
effort: "1d"
dependencies: [4]
---

# Phase 5: API Contracts and Download

## Context Links

- Contracts: `packages/api/src/contracts/shopify-stores.ts`, `contracts/index.ts`
- Routers: `packages/api/src/routers/shopify-stores.ts`, `routers/index.ts`, `routers/authz.ts`, `routers/shopify-errors.ts`
- Raw routes outside oRPC: `packages/api/src/app.ts` (`SHOPIFY_OAUTH_CALLBACK_PATH`, webhook route)
- Job registration: `packages/api/src/jobs.ts`
- Integration harness: `packages/api/integration/support.ts`, `shopify-stores.integration.test.ts`
- OpenAPI snapshot test: `packages/api/src/openapi.test.ts`

## Overview

Expose connections and backups through contract-first routes with permission checks, register the backup job, and add an authenticated download route.

## Key Insights

- Record-level authorization in `authz.ts` returns not-found to non-members and 403 to members without the permission, so a record's existence is not revealed. The new routes follow the same rule.
- oRPC handlers return JSON. A multi-gigabyte download belongs on a plain Hono route, like the OAuth callback.
- The S3 provider can issue a signed download URL; the local provider cannot. Redirecting to a signed URL keeps large downloads off the API process when it is available.
- The browser reaches the API through the Next.js `/api/:path*` rewrite. Whether that rewrite streams a very large response is unverified.

## Requirements

Routes (all under an organization, all returning public shapes with no URL or ciphertext):

| Route | Permission |
|-------|------------|
| `databaseConnections.list`, `.get` | `databases:read` |
| `databaseConnections.create`, `.update`, `.delete` | `databases:manage` |
| `databaseConnections.check` | `databases:read` |
| `databaseBackups.list`, `.get` | `databases:read` |
| `databaseBackups.start`, `.delete` | `databases:backup` |
| `GET /api/databases/backups/:backupId/download` | `databases:backup` |

- The public connection shape has: id, name, engine, host, port, database name, username, server version, last check time and error, timestamps.
- The public backup shape has: id, connection id and name, engine, database name, status, file name, size (as a string, since it is a `BigInt`), checksum, tool and server versions, error, timestamps.
- The download route requires a session, checks the permission on the backup's organization, writes audit `database.backup.downloaded`, then either redirects to a short-lived signed URL or streams the object with `Content-Disposition: attachment`, `Content-Length` and `Content-Type: application/octet-stream`.
- `DatabaseToolsError` codes map to API errors: `INVALID_URL`, `UNSUPPORTED_ENGINE` and `CONNECTION_FAILED` to 400-class with their message; `NAME_TAKEN` and `CONNECTION_BUSY` to 409; `NOT_FOUND` to 404.

## Related Code Files

- Create: `packages/api/src/contracts/database-connections.ts`, `contracts/database-backups.ts`
- Modify: `packages/api/src/contracts/index.ts`
- Create: `packages/api/src/routers/database-connections.ts`, `routers/database-backups.ts`, `routers/database-errors.ts`
- Modify: `packages/api/src/routers/index.ts`, `routers/authz.ts` (helpers `requireConnectionPermission`, `requireBackupPermission`)
- Create: `packages/api/src/database-backup-download-route.ts`
- Modify: `packages/api/src/app.ts` (mount the download route), `packages/api/src/jobs.ts` (register the backup job and run the stale-row sweep)
- Modify: `packages/api/package.json` (add `@repo/database-tools`)
- Create: `packages/api/integration/databases.integration.test.ts`
- Modify: `packages/api/src/openapi.test.ts` expectations if it lists routes

## Implementation Steps

1. Write the two contracts with zod schemas. The create and update inputs accept the URL as a string with a sensible length cap; no output schema includes it.
2. Write the error mapper and the two routers, using `requireOrganizationAccess` for organization-level routes and the new record-level helpers for routes addressed by id.
3. Register `createDatabaseBackupJob()` in `registerJobs` and call the stale-row sweep at startup.
4. Write the download route. Prefer `getSignedDownloadUrl` with a 60 second expiry when the provider has it; otherwise pipe `getObjectStream` to the response and stop reading if the client disconnects.
5. Integration tests with the API harness and real permissions:
   - Owner creates, lists, checks, renames and deletes a connection.
   - Member and Viewer get 403 on every route; a user outside the organization gets 404 on id routes.
   - Owner starts a backup, polls `get` until `COMPLETED`, downloads it, and the bytes match the stored checksum.
   - Download as a Member is refused; download of another organization's backup is not found.
   - Deleting a connection with a running backup returns 409.
   - Scan every response body collected by the harness for the password and the URL; none may appear.
   - Audit rows exist for create, backup start, download and delete, none containing the password.
6. Verify the download through the app origin, not only the API port: run both dev servers, download an archive of at least 1 GB through `http://localhost:3000/api/...`, and watch the API and Next.js process memory. If the rewrite buffers or times out, make the UI link to `NEXT_PUBLIC_API_URL` directly for this one route, or require a signed-URL-capable provider for large files, and record which in the plan.

## Todo

- [x] Contracts
- [x] Routers and error mapping
- [x] Record-level authorization helpers
- [x] Job registered, stale-row sweep at startup
- [x] Download route (signed URL or stream)
- [x] Integration tests: happy path, permissions, conflict, secret scan, audit
- [x] Large download verified through the app origin; outcome recorded

## Success Criteria

- `pnpm --filter @repo/api test` and `test:integration` pass.
- `pnpm check-types` and `pnpm boundaries` pass.
- The 1 GB download completes through the app origin with flat memory, or the documented fallback is in place.

## Risk Assessment

- **The rewrite cannot stream large files.** Step 6 finds out early and names two fallbacks.
- **Cross-origin download with cookies.** If the fallback links to the API origin directly, the session cookie must reach it; check cookie domain and `SameSite` before choosing that fallback.
- **The origin check middleware rejects a plain GET navigation.** Confirm the download route is treated like other GET routes; it changes no state apart from the audit record.

## Security Considerations

- The permission is checked on every download request; there is no long-lived link. A signed URL lasts 60 seconds.
- The file name in `Content-Disposition` comes from the stored, already sanitised name.
- No route returns `urlEncrypted`, and the update route never echoes the URL back.

## Next Steps

Phase 6 builds the UI on these routes.
