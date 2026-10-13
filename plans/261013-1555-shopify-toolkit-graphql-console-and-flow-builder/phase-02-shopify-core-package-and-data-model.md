---
phase: 2
title: "Phase 2: Shopify Core Package and Data Model"
status: todo
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 2: Shopify Core Package and Data Model

## Context Links

- Port sources in `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/packages/shopify/src/`: `admin-client.ts`, `crypto/token-encryption.ts`, `oauth/oauth-validation.ts`, `oauth/authorization-code-adapter.ts`, `oauth/token-exchange-adapter.ts`, `oauth/shopify-token-service.ts`, `oauth/types.ts`
- Model shapes to adapt: `ShopifyStore`, `ShopifyToken`, `ShopifyApp`, `ShopifyOAuthState` in `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/packages/database/prisma/schema.prisma`
- Permission catalog: `packages/access-control/src/catalog.ts`, presets in `packages/access-control/src/roles.ts`
- Role syncing: `packages/database/src/system-roles.ts`
- Shopify docs: client credentials grant, offline access tokens (expiry and refresh)

## Overview

Create `@repo/shopify`: the Admin GraphQL client, secret encryption, OAuth protocol helpers, the three credential strategies, and the Prisma models and permissions every later phase builds on. No routes or UI in this phase.

## Key Insights

- The evisu client takes `accessTokenEncrypted` and decrypts internally, and it throws on any GraphQL `errors`. The console needs errors passed through untouched, so the port returns the raw body and a separate wrapper throws for programmatic callers.
- evisu's adapters never send `expiring`, so custom apps receive non-expiring offline tokens. Expiring tokens last 1 hour, refresh tokens 90 days, and **every refresh rotates the refresh token**. Concurrent refreshes would invalidate each other, so refresh runs under a Postgres advisory lock.
- Client-credentials tokens always expire after 86399 seconds and cannot be refreshed; they are re-requested.
- evisu tests use Jest (`@jest/globals`); this repository uses Vitest.
- `syncSystemRoles` runs only at organization creation, invitation and seed, so existing organizations need an explicit resync when the catalog grows.
- `IntegrationConnection` in the boilerplate stores an untyped `config` JSON. Tokens need encryption, expiry and relations, so dedicated tables are used and `IntegrationConnection` is left untouched.

## Requirements

- Shop domains are accepted only when they match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$` after normalisation. Every outbound URL is built from the validated domain.
- Secrets (access tokens, refresh tokens, app client secrets) are stored AES-256-GCM encrypted with a `v1.` format prefix and are never logged or returned by any exported function except the token resolver.
- The Admin client is injectable (`fetchImpl`) so tests never reach the network.
- Token resolution is correct for all three strategies, including renewal near expiry.
- Repository functions are organization-scoped; a store id from another organization resolves to "not found".

## Architecture

Package `packages/shopify` (`@repo/shopify`), server-only, allowed to import `@repo/database` and `@repo/logger`.

```text
src/
  keys.ts                    env contract
  shop-domain.ts             normalizeShopDomain
  crypto/secret-encryption.ts
  admin/admin-client.ts      executeAdminGraphql -> { httpStatus, body, requestId, cost }
  admin/errors.ts            ShopifyGraphqlError, ShopifyUserErrorsError, ShopifyTransportError
  admin/cost.ts              parse extensions.cost and throttleStatus
  graphql/classify-operation.ts   query | mutation | subscription | introspection
  oauth/                     validation, two adapters, token service, refresh, client credentials
  stores/store-repository.ts organization-scoped reads and writes
  stores/access-token-resolver.ts
  stores/store-client.ts     createStoreClient(storeId) -> request(), requestOrThrow()
  stores/health-check.ts
  testing/fake-shopify-server.ts  test-only Admin API and token endpoint
```

Subpath exports: `.`, `./keys`, `./admin`, `./graphql`, `./oauth`, `./stores`, `./crypto`, `./testing`.

Data model (added to `packages/database/prisma/schema.prisma`):

```prisma
enum ShopifyCredentialStrategy { STATIC_TOKEN OAUTH CLIENT_CREDENTIALS }
enum ShopifyStoreStatus { PENDING CONNECTED RECONNECT_REQUIRED DISCONNECTED }
enum ShopifyTokenMode { NON_EXPIRING EXPIRING }

model ShopifyApp {
  id String @id @default(cuid())
  organizationId String
  name String
  clientId String
  clientSecretEncrypted String @db.Text
  scopes String[]
  installLink String? @db.Text
  tokenMode ShopifyTokenMode @default(NON_EXPIRING)
  createdById String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([organizationId, clientId])
}

model ShopifyStore {
  id String @id @default(cuid())
  organizationId String
  appId String?
  shopDomain String
  name String
  strategy ShopifyCredentialStrategy
  status ShopifyStoreStatus @default(PENDING)
  scopes String[]
  apiVersion String
  currencyCode String?
  connectedAt DateTime?
  lastHealthCheckAt DateTime?
  lastHealthCheckError String? @db.Text
  createdById String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([organizationId, shopDomain])
  @@unique([id, organizationId])
}

model ShopifyToken {
  id String @id @default(cuid())
  storeId String
  accessTokenEncrypted String @db.Text
  refreshTokenEncrypted String? @db.Text
  accessTokenExpiresAt DateTime?
  refreshTokenExpiresAt DateTime?
  scopes String[]
  rotatedAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())
  @@index([storeId, revokedAt])
}

model ShopifyOAuthState {
  id String @id @default(cuid())
  storeId String
  stateHash String @unique
  createdByUserId String
  expiresAt DateTime
  consumedAt DateTime?
  createdAt DateTime @default(now())
}
```

Relations: `Organization` 1—n `ShopifyApp`, `ShopifyStore` (cascade on organization delete); `ShopifyApp` 1—n `ShopifyStore` (restrict delete while stores reference it); `ShopifyStore` 1—n `ShopifyToken`, `ShopifyOAuthState` (cascade).

Token resolution (`resolveAccessToken(storeId)`):

1. `STATIC_TOKEN`: decrypt the latest non-revoked token.
2. `CLIENT_CREDENTIALS`: reuse the cached token while it has more than 5 minutes left; otherwise take `pg_advisory_xact_lock` on the store id, re-check, request a new token, persist it.
3. `OAUTH`: reuse the token when it has no expiry or more than 5 minutes left; otherwise take the same lock, re-check, call the refresh grant, persist the new access and refresh tokens, mark the previous row `rotatedAt`.

A 401 from Shopify on any request marks the store `RECONNECT_REQUIRED` with the error recorded.

## Related Code Files

- Create: `packages/shopify/package.json`, `packages/shopify/tsconfig.json`, and every file in the tree above with a colocated `*.test.ts`
- Create: `packages/shopify/integration/token-resolver.integration.test.ts`
- Create: `packages/database/src/sync-all-system-roles.ts`
- Create: one Prisma migration, `shopify_store_connections`
- Modify: `packages/database/prisma/schema.prisma`, `packages/database/package.json` (script), root `package.json` (`db:sync-roles`)
- Modify: `packages/access-control/src/catalog.ts`, `packages/access-control/src/roles.ts` and their tests
- Modify: `boundaries.config.json`, `.env.example`, `.env.test.example`, `turbo.json`, `apps/api/env.ts`

## Implementation Steps

1. Scaffold `packages/shopify` following `packages/jobs/package.json` (source-only package, Vitest scripts). Add dependencies `@repo/database`, `@repo/logger`, `@t3-oss/env-core`, `zod`, `graphql`.
2. Write `keys.ts`: `SHOPIFY_TOKEN_ENCRYPTION_KEY` (required, at least 32 characters), `SHOPIFY_API_VERSION` (optional, defaults to a package constant), `SHOPIFY_ADMIN_BASE_URL_OVERRIDE` (optional; the package throws at load when it is set and `NODE_ENV` is `production`).
3. Register the env names in `.env.example`, `.env.test.example`, the `env` arrays in `turbo.json`, and extend `apps/api/env.ts` with the new keys. `scripts/env/turbo-env-contract.test.ts` must stay green.
4. Port `normalizeShopDomain`, `hashOAuthState`, `safeEqual`, `verifyShopifyOAuthHmac`, `verifyAndDecodeShopifySessionToken`. Tighten the domain check to the regex in Requirements.
5. Port encryption as `encryptSecret` / `decryptSecret`, reading the key from `keys()` and emitting `v1.<iv>.<tag>.<ciphertext>`.
6. Port the Admin client as `executeAdminGraphql`: plaintext token in, raw body out, `Shopify-GraphQL-Cost-Debug: 1` when `costDebug` is set, a caller-supplied timeout (default 60 seconds; interactive routes pass a shorter one), cost parsed from `extensions.cost`. Add `requestOrThrow` that raises the ported error classes.
7. Write `classifyOperation(document, operationName)` with the `graphql` parser: returns the selected operation type, rejects documents with several operations and no `operationName`, and flags introspection when every root field starts with `__`.
8. Port both OAuth adapters and the token service. Add an `expiring` option that sends `expiring: 1`. Add `refreshAccessToken` (refresh grant) and `requestClientCredentialsToken` (form-encoded `grant_type=client_credentials`). Confirm the exact refresh `grant_type` value against the Shopify offline-access-token documentation while implementing.
9. Add the Prisma models and enums, run `pnpm db:migrate:dev --name shopify_store_connections`, then `pnpm db:generate`.
10. Write `store-repository.ts`, `access-token-resolver.ts`, `store-client.ts`, `health-check.ts`. The health check runs `shop { name myshopifyDomain currencyCode }` and `currentAppInstallation { accessScopes { handle } }` and stores the results.
11. Write `testing/fake-shopify-server.ts`: an in-process HTTP server answering `/admin/api/:version/graphql.json` (introspection of a small schema, `shop`, order lookup, `tagsAdd`, configurable `THROTTLED` and 401 responses) and `/admin/oauth/access_token` for all three grants.
12. Add permissions to the catalog: `stores:read`, `stores:manage`, `graphql:query`, `graphql:mutate`. Extend `MEMBER_PERMISSIONS` with `stores:read`, `graphql:query` and `graphql:mutate`; managing connections stays with Admin, Owner and custom roles. <!-- Updated: Validation Session 1 - Member may run mutations -->
13. Write `sync-all-system-roles.ts` (iterate organizations, call `syncSystemRoles` in a transaction each) and expose it as `pnpm db:sync-roles`.
14. Add `@repo/shopify` to `boundaries.config.json` (`packageRules`: `@repo/database`, `@repo/logger`; `clientSafeEntrypoints`: empty) and add it to the `@repo/api` allowlist.
15. Convert the ported evisu tests to Vitest and write the new unit and integration tests listed below.
16. Update `docs/architecture.md` with the package and the token lifecycle. Commit.

## Todo

- [x] Package scaffolded with env contract registered in `.env.example` and `turbo.json`
- [x] Domain validation, encryption and OAuth validation ported with tests
- [x] Admin client and operation classifier implemented with tests
- [x] Refresh and client-credentials grants implemented
- [x] Prisma models migrated
- [x] Token resolver, store client and health check implemented
- [x] Fake Shopify server available from `@repo/shopify/testing`
- [x] Permission catalog extended and `db:sync-roles` added
- [x] Boundary rules updated; `pnpm boundaries` green
- [x] Docs updated and phase committed

## Success Criteria

- `pnpm --filter @repo/shopify test` passes: encryption round-trip and tamper rejection, domain rejection of `evil.com` and `a.myshopify.com.evil.com`, HMAC and session-token validation, classifier cases (query, mutation, subscription, multiple operations, parse error, introspection), cost parsing.
- Integration test against Postgres: two concurrent `resolveAccessToken` calls for an expired client-credentials store produce exactly one token request; an expiring OAuth token is refreshed once and the old row is marked rotated; a 401 flips the store to `RECONNECT_REQUIRED`; a store id from another organization returns not found.
- `pnpm check:ci`, `pnpm check-types`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **Refresh grant request shape differs from the assumption.** Signal: the documentation check in step 8 or a 400 from a real store. Response: adjust within this phase; the lock and persistence design does not change.
- **Advisory lock holds a connection during a Shopify call.** Signal: pool exhaustion warnings. Response: the 60-second client timeout bounds it; renewal is rare. If it shows up under load, move the HTTP call outside the transaction and guard with a short-lived lock row.
- **`SHOPIFY_TOKEN_ENCRYPTION_KEY` lost or changed.** Every stored secret becomes unreadable. Response: document that the key must be backed up; the `v1.` prefix leaves room for a keyed rotation later.

## Security Considerations

- Strict domain validation is the SSRF boundary for every server-side Shopify request.
- `SHOPIFY_ADMIN_BASE_URL_OVERRIDE` exists only so browser tests can target the fake server; it is refused in production at load time.
- Error classes carry shop domain, status and Shopify request id, never the token or request headers.
- No API output type in later phases may include a decrypted or encrypted secret field.

## Next Steps

Phase 3 exposes these services through routes and UI. Phase 5 adds throttle-aware retry on top of `store-client.ts`.
