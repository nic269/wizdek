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

## Flow engine

`packages/flows` (`@repo/flows`) holds the flow format, the node registry, the executor and the services behind the flows API. `@repo/flows/definition` is the client-safe part: schemas, validation, templates, conditions and the built-in node specs. The server entry adds behaviour and persistence.

### Definitions are data

A flow version stores `{ schemaVersion: 1, nodes, edges }` as JSON. A node has an id, a type, a name, a canvas position and a `config`; an edge leaves one of its source node's output handles. Nothing in a definition is executable. Templates such as `{{ $json.Total }}` or `{{ $json["Order Name"] }}` look up paths in the item (`$json`), the run's inputs (`$trigger`) and the run (`$run`); they cannot call anything and cannot reach `__proto__`, `constructor` or `prototype`.

Versions are immutable and numbered per flow. Saving takes the version the editor loaded (`baseVersion`) and is refused with 409 when someone else saved in between. A draft may be saved with validation issues; a run needs a valid flow and references the exact version it executed.

`validateFlowDefinition` is a pure function over a definition and the available node specs, so the canvas and the server apply the same rules: exactly one trigger, no cycles, every node reachable from the trigger, config valid against the node's schema, edges attached to existing nodes and output handles.

### Nodes

A node type is a spec (type, category, label, config schema, outputs, `mode`, `idempotent`, `concurrency`) plus an `execute` function, joined with `defineNode`. The spec lives in `src/definition/specs/` and is shared with the browser; the behaviour lives in `src/nodes/`. A node type is added by writing those two files and listing it in `src/nodes/index.ts`. The executor knows nothing about specific node types.

`execute({ item, config, ctx })` returns `{ outputs: [{ handle, json }] }`. `ctx` offers the run and store, `shopify.request` (token resolved, throttle-aware), `storage.readAsset`, `resolve` for templates, persisted `stepState`, a logger and the abort signal. Outputs can also be a function of the config, and `mode` can be `batch`; the executor runs `item` mode today.

Built-in nodes: `trigger.manual`, `data.parseCsv`, `logic.if`, `shopify.findOrder`, `shopify.addTags`.

### The item model

Every node receives and emits items. A `FlowRunItem` row is one input item waiting at one node. When a node finishes an item, one transaction marks that row done and inserts the emitted items as `PENDING` rows of each connected node. That row is at once the checkpoint, the per-item trace and the hand-off between nodes.

Item keys are deterministic, which is what makes the insert safe to repeat: the trigger's item is `0`; a node that turns one item into many appends `.<index>`; a one-to-one node keeps the key. A node with several incoming edges also gets the source node in the key, so items arriving by different paths do not collide.

### Running

A run executes in one store, chosen when it starts. One `flow-run` job per run is queued with the store as its concurrency key, so runs for one store go one at a time and runs for different stores go in parallel.

```text
load run and version -> order the nodes from the trigger
for each node:
  skip it if its step already finished
  no items arrived -> step SKIPPED
  loop over PENDING items, `concurrency` at a time:
    node not idempotent: mark the item IN_PROGRESS before the call
    execute -> checkpoint (item SUCCEEDED + next nodes' PENDING rows)
    item error -> item FAILED with its message; the others continue
    between batches: stop if cancel was requested or the process is stopping
  step SUCCEEDED
finish: SUCCEEDED, or PARTIALLY_FAILED when any item is FAILED or UNKNOWN
```

| Outcome | When |
|---------|------|
| Item `FAILED` | Something was wrong with that item: an unknown order, a value that is not a number, `userErrors` from Shopify |
| Run `FAILED` | The node cannot work at all: the store rejected its credentials, or the config is invalid at run time. Remaining items stay `PENDING`. |
| Run `CANCELED` | Cancel was requested. The item in progress finishes; the rest stay `PENDING`. |
| Run interrupted | The process is stopping. The run stays `RUNNING` and the job is delivered again. |

### At-least-once, and what is never repeated

Resuming a run carries on from the first item without a checkpoint. An item whose checkpoint was written is never executed again.

A Shopify call can succeed just before a crash, before its checkpoint is written. What happens next depends on the node:

- An **idempotent** node (`shopify.addTags`, lookups) simply runs the item again. Adding a tag that is already there changes nothing.
- A node that is **not idempotent** marks the item `IN_PROGRESS` before the call. An item found in that state on resume is recorded as `UNKNOWN` and is not retried, because its effect may or may not have been applied. The same applies when such a call fails in transit. Someone has to check the store.

Limits: 100 nodes per flow, 100,000 items per run, 1 MB per item, 10 MB per uploaded file.

### API

`contracts/flows.ts` and `routers/flows.ts` expose flows under `/api/organizations/{organizationId}/flows` and `/api/flows/{flowId}`, and runs under `/api/flow-runs/{runId}`. Reading needs `flows:read`, authoring `flows:manage`, starting and canceling runs `flows:run`. Members can read and run; authoring stays with Admin, Owner and custom roles. `flows:run` lets a person change store data through any action node with the full scopes of the store's token, so grant it accordingly.

`files.upload` accepts one CSV file per request as multipart form data, up to 10 MB, for use as a run input. The store and any uploaded file must belong to the flow's organization. Writes to the flow, run and upload routes pass the same origin check as `/api/shopify/*`.

Run items hold business data from CSV files and stores. They are organization-scoped and readable with `flows:read`. They are kept indefinitely for now; a retention policy is needed before the product is opened beyond internal use.

### Flow builder

The builder at `/flows/[flowId]` edits the same definition the engine runs. `flow-definition-mapping.ts` translates between a definition and the canvas nodes and edges of `@xyflow/react`; applying it in both directions changes nothing, so "unsaved" simply means the canvas no longer matches the saved definition. `use-flow-editor.ts` holds that state and the save, which sends `baseVersion` and opens a dialog on a 409 while keeping the local edits.

Validation in the browser calls the same `validateFlowDefinition` the server uses, with the built-in specs from `@repo/flows/definition`, so issues appear as the flow is edited. The server stays the authority on save and run. `connection-rules.ts` refuses, while a connection is being made, anything that would form a loop, connect a step to itself or lead into a trigger.

Each built-in node has a form under `config-forms/`. Any other node type gets `generic-form.tsx`, which builds a form from the JSON Schema that `flows.nodeTypes` returns: text, number, yes/no, choice and text-list fields get a control, and anything else is edited as JSON. A new node type is therefore configurable without UI work.

The page shell reads the caller's `flows:manage` permission on the server and passes it down. Without it the canvas is read-only: no palette, no save, inputs disabled. That is a convenience; `flows.saveVersion` enforces the permission.

### Runs and trace

`run-dialog.tsx` starts a run from the builder: it uploads any file input through `files.upload`, then calls `flows.runs.start` with the returned id. The run page (`runs/[runId]/run-trace.tsx`) renders the definition of the run's own version on the same canvas and node component as the builder, read-only, with per-node status and counts supplied through `RunOverlayContext`. Edge labels come from `emitted`, the number of items each node sent out of each output handle, which `flows.runs.get` computes with grouped queries. `use-run-polling.ts` refetches every two seconds while the run is queued or running and stops once it is final. Items are paged on the server, 50 at a time.

`apps/api/integration/flow-run-resume.integration.test.ts` runs the built API as its own process, kills it with `SIGKILL` part-way through a 300-row run, starts it again, and checks that the run finishes with every order tagged exactly once.

User-facing behaviour is in [Flows](./flows.md).

## Planned product code

These locations are reserved by the implementation plan and are added phase by phase. This section is updated as each one lands.

| Location | Purpose |
|----------|---------|
| `packages/flows` | Webhook and schedule triggers, more node types |

## Local development

Follow the setup in the [root README](../README.md). If another project already holds port 5432, set `POSTGRES_PORT` and the port in `DATABASE_URL` to a free port in `.env`; `docker-compose.yml` reads `POSTGRES_PORT`.

`pnpm release:check` runs lint, type checks, tests, boundary checks and the build in one command.
