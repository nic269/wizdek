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

## GraphQL console

`shopifyGraphql.execute` (`POST /api/shopify/stores/{storeId}/graphql`) is a proxy: it authorizes the caller, forwards the document with the store's own token, and returns Shopify's body untouched together with status, cost and error counts. The orchestration lives in `executeGraphqlForUser` in `@repo/shopify/graphql`, so the router stays thin:

```text
session -> requireStorePermission(store, "graphql", "query")
classifyOperation(query, operationName)
  parse error            -> GraphQL-shaped error body, nothing forwarded
  subscription/ambiguous -> 422
  mutation               -> requires "graphql:mutate"
store client request (25-second timeout)
unless introspection -> AuditLog shopify.graphql.query | shopify.graphql.mutation
```

`shopifyGraphql.versions` lists the store's `publicApiVersions`. `savedQueries.*` stores shared queries in `SavedGraphqlQuery`, unique by name per organization. `requireAppOrigin` in `packages/api/src/origin-check.ts` guards writes under `/api/shopify/*`.

The page lives in `apps/app/app/graphql/`. `graphql-console.tsx` renders GraphiQL with the history, Explorer and saved-queries plugins and is loaded with `ssr: false`. `use-console-fetcher.ts` builds the fetcher; its identity changes only with the store or API version, which is what makes GraphiQL reload the schema without resetting tabs. `console-storage.ts` namespaces GraphiQL's browser storage by user and organization. GraphiQL's stylesheet is imported only by the console module, and the console's own rules are scoped to its container.

User-facing behaviour, permissions, audit contents and limits are in [GraphQL console](./graphql-console.md).

## Background jobs

`@repo/jobs` defines `JobQueueProvider` with two implementations. The local provider keeps jobs in memory and is the default for tests. The pg-boss provider (`@repo/jobs/pg-boss`) stores jobs in Postgres so queued and running work survives a restart; `JOBS_PROVIDER=pgboss` selects it, and production refuses to start without it.

A job definition can ask to run one job at a time per `concurrencyKey` (`serialPerKey`), declare a heartbeat so a dead worker's job is delivered again, and set retries and a timeout. Jobs can be enqueued with an idempotency key inside a scope key, a start delay, or on a cron schedule. Handlers receive `{ runId, signal }`; the signal aborts when the provider stops.

`packages/api/src/jobs.ts` owns the process-wide provider (`getJobProvider`) and the list of registered jobs (`registerJobs`). `apps/api/src/index.ts` starts the provider before serving and stops it on `SIGTERM` and `SIGINT`, which aborts running handlers and waits for them. Set `JOBS_WORKER_ENABLED=false` on a process that should enqueue jobs but not run them.

pg-boss keeps its tables in its own `pgboss` schema, outside Prisma's migrations. `prisma migrate reset` leaves it in place; drop the schema explicitly for a clean local queue. [Decision 0004](./decisions/0004-durable-jobs-on-pg-boss.md) records the mapping, what was tested, and the behaviours worth knowing.

Background Shopify requests use `requestWithRetry` on the store client (`packages/shopify/src/admin/throttle.ts`). It remembers the cost bucket each store last reported and holds a request until the bucket, refilling at its restore rate, can cover the expected cost. A `THROTTLED` answer is waited out and retried, since that request was not executed. Network failures and 5xx answers are retried up to three times with backoff, unless the caller passes `retryUncertain: false` for a mutation that is not safe to repeat. Bucket state is per process; contention from another process is absorbed by the `THROTTLED` path.

## Planned product code

These locations are reserved by the implementation plan and are added phase by phase. This section is updated as each one lands.

| Location | Purpose |
|----------|---------|
| `packages/database` | Flow and run models |
| `packages/api` | Contracts and routers for flows and runs |
| Flow engine package | Graph validation, typed node registry and the item-based executor |
| `apps/app` | Flow builder canvas, run trace |

## Local development

Follow the setup in the [root README](../README.md). If another project already holds port 5432, set `POSTGRES_PORT` and the port in `DATABASE_URL` to a free port in `.env`; `docker-compose.yml` reads `POSTGRES_PORT`.

`pnpm release:check` runs lint, type checks, tests, boundary checks and the build in one command.
