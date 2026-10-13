# Architecture

Shopify Toolkit is a developer toolkit for teams that work across many Shopify stores. A developer in an organization connects stores, runs Admin GraphQL against them in a console, and builds flows that run durably with a per-node, per-item trace.

## System shape

The repository is a pnpm and Turborepo monorepo generated from the Wizloft boilerplate (`saas` profile, apps `app` and `api`). `boilerplate.receipt.json` records the generation source.

| Part | Role | Local port |
|------|------|-----------|
| `apps/app` | Next.js App Router UI | 3000 |
| `apps/api` | Hono server exposing contract-first oRPC routes and Better Auth | 3002 |
| Postgres 17 | Application data, and later the job queue | `POSTGRES_PORT` in `.env` |

The browser reaches the API same-origin through the rewrites in `apps/app/next.config.ts` (`/api/:path*`), so session cookies and origin checks apply to every API call.

Tenancy is the boilerplate's Organization model. Every product record belongs to an organization, and permissions come from the catalog in `packages/access-control`.

## Packages

Existing packages under `packages/` come from the boilerplate: `api` (contracts and routers), `auth`, `access-control`, `database` (Prisma schema and migrations), `jobs`, `storage`, `design-system`, and supporting packages. Import rules between them are declared in `boundaries.config.json` and enforced by `pnpm boundaries`.

## Shopify package

`packages/shopify` (`@repo/shopify`) is server-only. It may import `@repo/database` and `@repo/logger`, and has no client-safe entry point.

| Entry point | Contents |
|-------------|----------|
| `@repo/shopify/keys` | Env contract: `SHOPIFY_TOKEN_ENCRYPTION_KEY`, `SHOPIFY_API_VERSION`, `SHOPIFY_ADMIN_BASE_URL_OVERRIDE` |
| `@repo/shopify/admin` | `executeAdminGraphql` returns Shopify's response body untouched, with cost and request id; `executeAdminGraphqlOrThrow` raises typed errors for programmatic callers |
| `@repo/shopify/graphql` | `classifyOperation` decides whether a document runs a query, mutation, subscription or introspection, without executing it |
| `@repo/shopify/oauth` | Callback HMAC and session-token validation, authorization-code and token-exchange adapters, refresh and client-credentials grants |
| `@repo/shopify/stores` | Organization-scoped store and app repository, access token resolver, per-store client, health check |
| `@repo/shopify/crypto` | AES-256-GCM `encryptSecret` and `decryptSecret` |
| `@repo/shopify/testing` | In-process fake Shopify server for tests |

### Data model

`ShopifyApp` holds an app's client id and encrypted client secret per organization. `ShopifyStore` is one connected shop, unique per organization and shop domain, with a credential strategy (`STATIC_TOKEN`, `OAUTH`, `CLIENT_CREDENTIALS`) and a status (`PENDING`, `CONNECTED`, `RECONNECT_REQUIRED`, `DISCONNECTED`). `ShopifyToken` rows hold encrypted access and refresh tokens; the active token is the newest row that is neither rotated nor revoked. `ShopifyOAuthState` holds hashed, single-use install state.

### Security boundaries

- Shop domains must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`. Every outbound URL is built from the validated domain in `shopOrigin`, which is the SSRF boundary for server-side Shopify requests.
- Access tokens, refresh tokens and client secrets are stored as `v1.<iv>.<tag>.<ciphertext>`. Only `resolveAccessToken` returns a decrypted token. Error classes carry the shop domain, status and request id, never a token.
- `SHOPIFY_ADMIN_BASE_URL_OVERRIDE` redirects every Shopify request to one origin so tests can use the fake server. Setting it with `NODE_ENV=production` fails at startup.
- `SHOPIFY_TOKEN_ENCRYPTION_KEY` must be backed up with the database. Losing or changing it makes every stored credential unreadable.

### Token lifecycle

`resolveAccessToken({ organizationId, storeId })` returns a usable token for a store, or fails with `StoreNotFoundError` when the store belongs to another organization.

| Strategy | Behaviour |
|----------|-----------|
| `STATIC_TOKEN` | Decrypts the pasted token. It never expires and is never renewed. |
| `CLIENT_CREDENTIALS` | Reuses the stored token while it has more than 5 minutes left, otherwise requests a new one. These tokens last about 24 hours and cannot be refreshed. |
| `OAUTH` | Reuses a non-expiring token, or an expiring one with more than 5 minutes left; otherwise calls the refresh grant and stores the new access and refresh tokens. |

Renewal runs inside a transaction holding a Postgres advisory lock keyed on the store id, and re-reads the token after taking the lock. Shopify rotates the refresh token on every refresh, so this keeps concurrent callers from invalidating each other: the second caller finds the token the first one stored. The replaced row is marked `rotatedAt`.

A store moves to `RECONNECT_REQUIRED` when Shopify answers a request with HTTP 401, or refuses a renewal. A successful health check moves it back to `CONNECTED` and refreshes its name, currency and granted scopes.

### Permissions

The catalog in `packages/access-control` adds `stores:read`, `stores:manage`, `graphql:query` and `graphql:mutate`. Members get the first, third and fourth; managing connections stays with Admin, Owner and custom roles. System roles are synced when an organization is created, so after changing the catalog or a preset run `pnpm db:sync-roles` to update existing organizations.

## Store connections

Routes live in `packages/api` (`contracts/shopify-apps.ts`, `contracts/shopify-stores.ts` and the matching routers). Organization-scoped routes sit under `/api/organizations/{organizationId}/shopify/...`; store-scoped routes sit under `/api/shopify/stores/{storeId}` and derive the organization from the store row, never from input. `requireStorePermission` in `routers/authz.ts` answers 404 for a store outside the caller's organizations and 403 for a member without the permission.

The connect services in `@repo/shopify/stores` verify credentials against Shopify first, then write the store, its token and an audit entry in one transaction. No API response carries a token or secret; apps report `hasClientSecret: true`.

OAuth completes in two steps so a callback URL alone can never attach a token to an organization:

1. `GET /api/shopify/oauth/callback` is a plain Hono route. It validates the `shop` parameter and redirects to `/stores/oauth/callback` on the configured app URL with the query unchanged. It changes no state.
2. The app page posts the query to `shopifyStores.completeOAuth`, which needs a session and `stores:manage`. It resolves the store from the single-use state (hashed at rest, valid 10 minutes, bound to the user who started the install), verifies the callback HMAC, exchanges the code and marks the store connected.

In the app, `app/lib/active-organization.tsx` provides the active organization to every toolkit page and renders the switcher in the top bar. User-facing steps are in [Connecting Shopify stores](./stores.md).

Browser tests run against the in-process fake Shopify server: `playwright.config.ts` starts it and passes its URL to the API as `SHOPIFY_ADMIN_BASE_URL_OVERRIDE`.

## Planned product code

These locations are reserved by the implementation plan and are added phase by phase. This section is updated as each one lands.

| Location | Purpose |
|----------|---------|
| `packages/database` | Flow and run models |
| `packages/api` | Contracts and routers for the GraphQL proxy, flows and runs |
| `packages/jobs` | `pg-boss` provider behind `JobQueueProvider`; the worker runs inside `apps/api` |
| Flow engine package | Graph validation, typed node registry and the item-based executor |
| `apps/app` | GraphiQL console with Explorer, flow builder canvas, run trace |

## Local development

Follow the setup in the [root README](../README.md). If another project already holds port 5432, set `POSTGRES_PORT` and the port in `DATABASE_URL` to a free port in `.env`; `docker-compose.yml` reads `POSTGRES_PORT`.

`pnpm release:check` runs lint, type checks, tests, boundary checks and the build in one command.
