---
phase: 8
title: "Phase 8: Built-in Helpers for Databases and Shopify Stores"
status: todo
priority: P1
effort: "3d"
dependencies: [4, 5, 6, 7]
---

# Phase 8: Built-in Helpers for Databases and Shopify Stores

## Context Links

- Shopify execution with mutation classification, audit and cost: `packages/shopify/src/graphql/execute-for-user.ts`, `classify-operation.ts`, `packages/shopify/src/stores/store-client.ts`
- Database connections and decryption: `packages/database-tools/src/connections/connections.ts` (`getConnection`, `openConnection`), TLS settings per sslmode: `packages/database-tools/src/engines/postgres/check.ts`, `packages/database-tools/src/redact.ts`
- Permission catalog: `packages/access-control/src/catalog.ts` (`stores:*`, `graphql:query|mutate`, `databases:*`)
- Run execution and env passing: `packages/functions/src/services/execute.ts`, `packages/functions/src/runner/client.ts` (`env`), `apps/runner/src/run-container.ts`
- Runtime images and wrappers: `apps/runner/runtimes/node/`, `apps/runner/runtimes/python/`
- Editor setup: `apps/app/app/functions/[functionId]/monaco-setup.ts`
- Session-less route pattern: `packages/api/src/shopify-webhook-route.ts`; the HTTP trigger route from phase 7
- API deployment: `infra:scripts/coolify/wizdek.py` (`wizdek-api` exposes 3002 to the Docker network only)

## Overview

Give scripts a preinstalled `wizdek` module that queries and writes the organization's connected databases and runs Shopify Admin GraphQL against its connected stores, without connection strings or tokens in the script. The sandbox never receives a credential: it calls a small runtime API on wizdek-api with a token that is valid only while the run lasts, and wizdek-api executes the call with the stored credentials.

```ts
import { db, shopify, ctx } from "wizdek";

export async function main(orderId: string) {
  const rows = await db("analytics").query(
    "select * from orders where id = $1", [orderId]);
  const { data } = await shopify("main-store").graphql(
    `query ($id: ID!) { order(id: $id) { name } }`, { id: orderId });
  await db("analytics").execute(
    "insert into notes (order_id, run_id) values ($1, $2)", [orderId, ctx.runId]);
  return data;
}
```

```python
from wizdek import db, shopify, ctx

def main(order_id: str):
    rows = db("analytics").query("select * from orders where id = %s", [order_id])
    ...
```

## Accepted Decisions (2026-11-21)

| Area | Decision |
|------|----------|
| Where credentials live | Only in wizdek-api. The sandbox gets a run token; the API decrypts and executes. Rejected: passing connection URLs or store tokens into the container (a function could print or send them; the docs promise no API returns a token). |
| Network path | The sandbox reaches wizdek-api directly on the LAN: one exception in the runner's egress filter to apps-prod's runtime port, from `fn-sandbox` only. Rejected: going out through the public origin (slower, depends on Cloudflare, and the Next rewrite cuts requests at 30 s). Local development uses `host.docker.internal`. |
| What a function may use | A per-function grant list of stores and database connections, edited by people with `functions:manage`. A run may use only granted resources, whatever triggered it. |
| PROD databases | Allowed, reads and writes, behind the grant and the audit log. |
| Shopify mutations | A store grant allows queries and mutations. The person granting needs `stores:read` and `graphql:mutate` on that store's organization at grant time. |

## Key Insights

- HTTP and schedule runs have no user session. Checking the starting user's permissions at call time would break them, so the grant list on the function is the authority, checked on every call. Granting is the privileged act and is audited.
- The run token must die with the run. Storing only its hash on the run row and accepting it only while the run is `QUEUED` or `RUNNING` gives that without a new table.
- `wizdek-api` in Coolify exposes 3002 only to the Docker network. The runner needs a published port bound to 10.10.10.30, and Docker-published ports bypass ufw, so the source restriction goes in apps-prod's `DOCKER-USER` chain.
- The runtime routes must not sit behind the 30-second Next rewrite or the app-origin check; they are served by wizdek-api directly on the published port.
- `execute-for-user.ts` already classifies, audits and reports cost for a user. The helper calls the same path with a function actor and `canMutate` answered by the grant, so audit and classification stay in one place.
- Shopify throttles by query cost. The SDK retries `THROTTLED` errors with the restore time Shopify reports, so scripts that page through many orders do not fail halfway.
- Database calls run in the API process. Each call opens one connection with a statement timeout and closes it; a row cap and a response size cap keep a careless `select *` from exhausting the API's memory.

## Requirements

Grants:

- `CodeFunctionGrant { functionId, kind STORE | DATABASE, resourceId, alias, createdById, createdAt }`, unique per function and resource, unique per function and alias.
- The alias is how scripts name the resource (`db("analytics")`, `shopify("main-store")`). It defaults to a slug of the resource's name and matches `^[a-z0-9][a-z0-9-]{0,39}$`. A script may also pass the resource id.
- Granting needs `functions:manage` plus, for a database, `databases:read`, and for a store, `stores:read` and `graphql:mutate`. The resource must belong to the same organization.
- Deleting a store or connection removes its grants. Grant and revoke are audited (`function.grant.added`, `function.grant.removed`).

Run token:

- When a run starts, the API creates a token (32 random bytes, base64url, prefix `wfr_`), stores its SHA-256 on the run, and passes `WIZDEK_RUNTIME_URL` and `WIZDEK_RUNTIME_TOKEN` to the container. `WIZDEK_` joins the reserved variable prefixes.
- The runtime API accepts the token only while the run is `QUEUED` or `RUNNING`, and clears the hash when the run finishes.
- The token value is scrubbed from stored output like an env var.
- Package installs get no token.

Runtime API, on wizdek-api, `Authorization: Bearer wfr_…`, JSON, body limit 1 MB:

| Route | Does |
|-------|------|
| `GET /api/fn-runtime/context` | Run id, function id and name, trigger, organization id, granted aliases by kind |
| `POST /api/fn-runtime/db/{alias}/query` | `{ sql, params }` → `{ rows, rowCount, fields, truncated }` |
| `POST /api/fn-runtime/shopify/{alias}/graphql` | `{ query, variables, operationName, apiVersion }` → Shopify's JSON plus cost |

- Unknown, finished or wrong token: 401 with an empty body. A resource that is not granted: 403 naming the alias.
- Database calls: parameterized only (`$1` in Node, `%s` translated in the Python SDK), statement timeout 60 s, at most 10 000 rows and 10 MB per response (`truncated: true` beyond that), at most 4 concurrent database calls per run.
- Shopify calls: the store's API version unless the script names one, the timeout of the run's remaining time capped at 60 s.
- At most 20 runtime calls in flight per run; beyond that 429.
- Each database call that is not a plain `SELECT` and each Shopify mutation is audited with the function as actor (`function.db.write`, `graphql.mutation` through the existing path), carrying the run id. Reads are counted on the run, not audited one by one.
- Errors from the database or Shopify come back with their message, with connection secrets redacted by `redactSecrets`.

SDK, preinstalled in both runtime images, version tied to the image:

- Node (`wizdek`, ESM with `.d.ts`): `db(alias).query<T>(sql, params)`, `db(alias).execute(sql, params)` (returns `rowCount`), `db(alias).transaction(async (tx) => …)`, `shopify(alias).graphql(query, variables)`, `shopify(alias).paginate(query, variables, { path })` (async iterator over `edges.node`, following `pageInfo`), `ctx`, `stores.list()`, `databases.list()`.
- Python (`wizdek`, standard library only): the same names in snake_case; `paginate` is a generator.
- Throttled Shopify calls are retried up to five times with Shopify's restore time. GraphQL `errors` raise an error that carries the response; `userErrors` are left to the script.
- `transaction` sends the statements as one call that the API runs in `BEGIN … COMMIT`, so no connection stays open across calls.
- A script that imports `wizdek` while running without a token (for example a test outside Wizdek) gets a clear error naming `WIZDEK_RUNTIME_TOKEN`.

Editor and UI:

- Monaco gets the Node SDK's `.d.ts` so `import { db } from "wizdek"` has completion and types.
- A "Connections" section in the function's side panel lists grants with alias and kind, adds a store or database from the organization's lists, and removes grants. Read-only without `functions:manage`.
- Run details show how many database and Shopify calls the run made.

## Architecture

```text
script (fn-sandbox, runner VM)
   │  import { db } from "wizdek"   WIZDEK_RUNTIME_URL + WIZDEK_RUNTIME_TOKEN
   ▼  egress exception: 10.210.1.0/24 → 10.10.10.30:3003 only
wizdek-api (apps-prod)  /api/fn-runtime/*
   │  token hash → active run → function → grant by alias
   ├──► openConnection() → pg, statement timeout, row cap ──► Postgres
   └──► executeGraphql (function actor, canMutate = grant) ──► Shopify Admin API
```

```prisma
enum CodeFunctionGrantKind { STORE DATABASE }
model CodeFunctionGrant {
  id, functionId, kind CodeFunctionGrantKind, resourceId, alias, createdById?, createdAt
  @@unique([functionId, kind, resourceId])
  @@unique([functionId, alias])
}
// CodeFunctionRun gains: runtimeTokenHash? @unique, dbCallCount Int @default(0), shopifyCallCount Int @default(0)
```

The runtime routes are a plain Hono sub-app (like the webhook route), mounted before the oRPC handler and listening on a second port, `FUNCTIONS_RUNTIME_PORT` (3003), so the published port exposes nothing else of the API. In development the same port is reached through `host.docker.internal`.

Contract additions (`manage` except reads):

| Route | Purpose |
|-------|---------|
| `GET /api/functions/{functionId}/grants` | List grants with resource names |
| `POST /api/functions/{functionId}/grants` | Add a grant `{ kind, resourceId, alias? }` |
| `DELETE /api/function-grants/{grantId}` | Remove a grant |

## Related Code Files

- Modify: `packages/database/prisma/schema.prisma`; create one migration
- Create: `packages/functions/src/services/grants.ts`, `run-token.ts`, `runtime-db.ts`, `runtime-shopify.ts`
- Modify: `packages/functions/src/services/execute.ts` (token, env, scrubbing, clear on finish), `runs.ts`, `audit.ts`, `index.ts`, `definition/index.ts` (reserved prefix)
- Modify: `packages/shopify/src/graphql/execute-for-user.ts` only if the actor type needs a function variant; prefer passing the function's audit actor through the existing input
- Create: `packages/database-tools/src/engines/postgres/query.ts` (parameterized query with TLS per sslmode, statement timeout, caps); export it
- Create: `packages/api/src/function-runtime-route.ts`; modify `apps/api` server start to listen on the runtime port; modify `packages/api/src/contracts/functions.ts`, `routers/functions.ts`, `routers/authz.ts`
- Create: `apps/runner/runtimes/node/sdk/` (`index.mjs`, `index.d.ts`, `package.json`), `apps/runner/runtimes/python/sdk/wizdek/__init__.py`; modify both Dockerfiles to install them
- Modify: `apps/app/app/functions/[functionId]/monaco-setup.ts` (add the SDK types), `side-panel.tsx`; create `connections-section.tsx`
- Modify: `turbo.json`, `.env.example` (`FUNCTIONS_RUNTIME_PORT`, `FUNCTIONS_RUNTIME_URL`)
- Modify: phase 1 egress rules and probe (the one exception); `infra:scripts/coolify/wizdek.py` (publish `10.10.10.30:3003`), apps-prod `DOCKER-USER` rule allowing 3003 from 10.10.10.50 only — infrastructure, owner approval
- Create or extend tests: `packages/functions/integration/runtime.integration.test.ts`, `packages/api/integration/function-runtime.integration.test.ts`, `apps/runner/integration/sdk.integration.test.ts`, `tests/e2e/functions.spec.ts`

## Implementation Steps

1. Add the model and run columns; create the migration (local DB, no backup needed).
2. Write the grant service with its permission checks, audit and cascade on resource deletion; add the contract routes.
3. Write the run token: create on start, pass as env, scrub, refuse after finish.
4. Write the parameterized Postgres query helper and the runtime database service.
5. Write the runtime Shopify service on top of `execute-for-user.ts`.
6. Write the runtime route and second listener; wire `FUNCTIONS_RUNTIME_URL` into runs.
7. Write the Node and Python SDKs, install them in the images (the image hash changes, so images rebuild).
8. Add SDK types to Monaco and the Connections section to the side panel.
9. Write the tests; run them against the fake runner and against the real runner locally.
10. Add the egress exception and probe line to phase 1's scripts, and the published port and `DOCKER-USER` rule to phase 9's deploy steps.

## Todo

- [ ] Grant model, migration, service and routes
- [ ] Run token lifecycle
- [ ] Runtime database and Shopify services
- [ ] Runtime route on its own port
- [ ] Node and Python SDKs in the images
- [ ] Editor types and Connections section
- [ ] Tests
- [ ] Phase 1 and phase 9 infrastructure steps updated

## Success Criteria

- A Node function and a Python function each read rows from a granted database, insert into another table, and run a Shopify query and a mutation on a granted store, with no connection string or token in their source or environment.
- Printing the whole environment inside a run shows `WIZDEK_RUNTIME_TOKEN` only as `[redacted]` in stored output, and no database URL or Shopify token appears anywhere.
- After the run ends, replaying its token gets 401. A token from another organization's run cannot reach this organization's resources.
- A run using an alias that is not granted gets 403 and the error names the alias; removing a grant blocks the next call.
- Granting a store without `graphql:mutate`, or a database without `databases:read`, is refused.
- A query over 10 000 rows returns `truncated: true`; a `pg_sleep(120)` is stopped by the statement timeout; the 21st concurrent call gets 429.
- An insert and a Shopify mutation each leave an audit entry naming the function and the run; a select leaves none and is counted on the run.
- An HTTP-triggered and a scheduled run can use granted resources.
- Monaco shows completion for `db(...).query`.
- On the runner, a sandbox reaches 10.10.10.30:3003 and nothing else on the LAN; from any other LAN host 3003 refuses.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| A function writes to a PROD database by mistake | Explicit grant per function and connection, the grant list visible in the editor, every write audited with the run id |
| A function leaks data it read | Accepted: the function's author already has access to those resources; output follows the existing run retention |
| Large results exhaust the API's memory | Row and byte caps, statement timeout, per-run concurrency limit |
| Long database or Shopify calls hold API resources | 60 s cap per call; cancelling the run makes the token invalid, and in-flight calls are aborted |
| The published port exposes more than the runtime routes | A separate listener that serves only `/api/fn-runtime/*`, bound to 10.10.10.30 and restricted to 10.10.10.50 in `DOCKER-USER` |
| A grant outlives the granting user's permissions | Accepted for now and recorded in decision 0006; grants are listed and removable |

## Security Considerations

- The run token is the only credential in the sandbox; it is scoped to one run, one organization and its grant list, and dies with the run.
- Credentials are decrypted only inside wizdek-api, per call, and never serialized into a response.
- Only parameterized SQL is sent; the API does not try to forbid DDL or writes, because PROD writes are allowed by decision.

## Next Steps

Phase 9 deploys this together with the rest, adding the published port and the firewall rule on apps-prod.
