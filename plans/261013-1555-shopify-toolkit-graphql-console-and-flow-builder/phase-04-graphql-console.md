---
phase: 4
title: "Phase 4: GraphQL Console"
status: todo
priority: P1
effort: "3.5d"
dependencies: [3]
---

# Phase 4: GraphQL Console

## Context Links

- Target experience: https://shopify-graphiql-app.shopifycloud.com (GraphiQL with the Explorer plugin, schema and version pickers, "Return detailed cost")
- Official Next.js example: https://github.com/graphql/graphiql/tree/main/examples/graphiql-nextjs (`'use client'`, `import 'graphiql/setup-workers/webpack'`, Next 15)
- Store client and classifier from phase 2: `packages/shopify/src/stores/store-client.ts`, `packages/shopify/src/graphql/classify-operation.ts`
- Audit model: `AuditLog` in `packages/database/prisma/schema.prisma`; writer precedent in `packages/auth/src/access-control.ts`
- Rewrites that carry browser calls to the API: `apps/app/next.config.ts`

## Overview

Deliver the console: an API proxy that runs arbitrary Admin GraphQL against a connected store with permission gating and audit, and a `/graphql` page embedding GraphiQL 5 with the Explorer plugin, store and API-version pickers, a cost toggle, a response status bar, and shared saved queries.

## Key Insights

- `graphiql` 5.4.0 edits with Monaco and needs web workers. The package ships `setup-workers/webpack`, `setup-workers/vite` and `setup-workers/esm.sh`; the official Next example uses the webpack variant on Next 15. This repository runs Next 16, where Turbopack is the default bundler, so worker bundling is unproven and is tested first.
- `@graphiql/plugin-explorer` 5.1.5 wraps `graphiql-explorer` 0.9.0, last published in 2022. It declares React 18 and 19 as peers, but rendering under React 19 in this app is confirmed in the same spike.
- GraphiQL persists tabs, history and settings through a pluggable `storage`. That satisfies per-browser persistence; saved queries are stored server-side so a team can share them.
- The console fetches the introspection result through the proxy on every load. It is several megabytes for the Admin API.
- A mutation on a production store is one click away. Permission is decided from the parsed document, not from what the client claims.

## Requirements

Functional:

- Pick a connected store and an API version; versions come from the store (`publicApiVersions`).
- Explorer tree for queries and mutations; ticking fields edits the query; autocomplete, docs, variables and headers editors work.
- "Return detailed cost" sends Shopify's cost-debug header; a status bar shows HTTP status, GraphQL error count, `userErrors` count, requested and actual cost, and throttle status.
- Tabs and history persist per browser; the selected store can change without losing the current query.
- Saved queries: create, list, load, rename, delete, shared within the organization.

Non-functional:

- `graphql:query` is required for queries and `graphql:mutate` for mutations; subscriptions and ambiguous documents are rejected; nothing is forwarded when permission fails.
- Every non-introspection execution writes an `AuditLog` row.
- The access token never leaves the server.
- Requests whose `Origin` header is present and differs from the app URL are refused on `/api/shopify/*`.

## Architecture

API (oRPC contracts):

| Operation | Method and path | Permission |
|-----------|-----------------|------------|
| `shopifyGraphql.execute` | POST `/api/shopify/stores/{storeId}/graphql` | by operation type |
| `shopifyGraphql.versions` | GET `/api/shopify/stores/{storeId}/api-versions` | `graphql:query` |
| `savedQueries.list` / `create` | GET, POST `/api/organizations/{organizationId}/graphql/saved-queries` | `graphql:query` |
| `savedQueries.update` / `delete` | PATCH, DELETE `.../saved-queries/{id}` | creator, or `stores:manage` |

`execute` input: `query` (at most 500 KB), `variables` (at most 1 MB as JSON), `operationName`, `apiVersion`, `costDebug`. Output: `{ data: { httpStatus, body, shopifyRequestId, cost } }`, where `body` is Shopify's JSON untouched.

```text
session -> requireStorePermission(store, "graphql", "query")
classifyOperation(query, operationName)
  parse error            -> return a GraphQL-shaped error body, nothing forwarded
  subscription/ambiguous -> 422
  mutation               -> require "graphql:mutate"
store client request (token resolved server-side, timeout below the rewrite proxy's limit)
if not introspection -> AuditLog { action: shopify.graphql.query|mutation, targetId: storeId, metadata }
```

Browser calls reach the API through the Next rewrite in `apps/app/next.config.ts`, which has its own proxy timeout. If the proxy gives up first, the browser sees an error while a mutation may still complete at Shopify. The execute timeout is therefore set below the proxy's, and the audit row is written whether or not the client is still waiting. <!-- Updated: Red Team Review - proxy and upstream timeouts were not aligned -->

Console executions are frequent, and `listAuditLogs` returns one unfiltered list per organization. It gains an optional action-prefix filter, and the audit list in the access settings gains a matching control, so membership events are not buried. <!-- Updated: Red Team Review - audit list would be flooded by console executions -->

Audit metadata: operation type and name, API version, HTTP status, GraphQL error count, `userErrors` count, requested and actual cost, duration, Shopify request id, SHA-256 of the document, the document text, and the variables as sent. <!-- Updated: Validation Session 1 - audit stores variables as well as the document -->

New model:

```prisma
model SavedGraphqlQuery {
  id String @id @default(cuid())
  organizationId String
  createdById String?
  name String
  query String @db.Text
  variables String? @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([organizationId, name])
}
```

UI (`apps/app/app/graphql/`):

- `page.tsx` (server shell) loads `graphql-console.tsx` through `next/dynamic` with `ssr: false`.
- `graphql-console.tsx`: `<GraphiQL>` with `explorerPlugin()` and the saved-queries plugin; fetcher from `use-console-fetcher.ts` calls `apiClient.shopifyGraphql.execute` and returns `data.body`.
- `console-toolbar.tsx`: store select, version select, cost switch.
- `response-status-bar.tsx`: reads the last execution result.
- `console-storage.ts`: `localStorage` wrapper namespaced by user and organization.

Bundling decision gate, evaluated in step 1:

1. Default Next 16 build with `graphiql/setup-workers/webpack`. Keep if the editor has working autocomplete in `next dev` and in a production build.
2. Otherwise run `apps/app` dev and build on webpack.
3. Otherwise build the console as a standalone Vite bundle served as static assets and embedded in an iframe, with store and version passed by `postMessage`.

## Related Code Files

- Create: `packages/api/src/contracts/shopify-graphql.ts`, `packages/api/src/contracts/saved-queries.ts`, `packages/api/src/routers/shopify-graphql.ts`, `packages/api/src/routers/saved-queries.ts`, `packages/api/src/origin-check.ts`, with tests
- Create: `packages/shopify/src/graphql/execute-for-user.ts`, `packages/shopify/src/graphql/user-errors.ts`
- Create: `apps/app/app/graphql/page.tsx`, `graphql-console.tsx`, `console-toolbar.tsx`, `response-status-bar.tsx`, `saved-queries-plugin.tsx`, `console-storage.ts`, `use-console-fetcher.ts`
- Create: one Prisma migration `saved_graphql_queries`; `tests/e2e/graphql-console.spec.ts`; `docs/graphql-console.md`
- Modify: `packages/database/prisma/schema.prisma`, `packages/api/src/contracts/index.ts`, `packages/api/src/routers/index.ts`, `packages/api/src/app.ts`
- Modify: `packages/auth/src/access-control.ts` (`listAuditLogs` action-prefix filter), `packages/api/src/contracts/organizations.ts`, `packages/api/src/routers/organizations.ts`, `apps/app/app/settings/access/access-panel.tsx`
- Modify: `apps/app/package.json` (`graphiql`, `@graphiql/plugin-explorer`, `graphql`), `apps/app/next.config.ts` if the gate requires it, `packages/config/src/navigation.ts` and its test, `apps/app/app/app-shell-layout.tsx`

## Implementation Steps

1. Spike. Add the three dependencies (pin `graphql` to the same major as `@repo/shopify`). Render GraphiQL with the Explorer plugin on a throwaway page against a hard-coded fetcher. Verify in `next dev` and in `next build && next start`: no worker errors in the console, autocomplete works, the Explorer renders and edits the query. Walk the decision gate and record the outcome in `docs/decisions/0003-graphiql-bundling.md`. Remove the throwaway page.
2. Write `origin-check.ts` and mount it in `app.ts` for non-GET requests under `/api/shopify/*`.
3. Write the `shopifyGraphql` contract and router following the flow above. Put the orchestration in `@repo/shopify` (`execute-for-user.ts`) so the router stays thin. Find the rewrite proxy timeout of the installed Next version, then either set the execute timeout a few seconds below it or raise the proxy timeout in `apps/app/next.config.ts`; record the two numbers in `docs/graphql-console.md`.
3a. Add the optional action-prefix filter to `listAuditLogs` and the `organizations.auditLogs` contract, and a filter control to the audit list in `access-panel.tsx`.
4. Write `user-errors.ts`: count arrays under keys ending in `userErrors` or `UserErrors` in each top-level `data` field.
5. Implement `versions` by running `publicApiVersions { handle displayName supported }` on the store.
6. Add `SavedGraphqlQuery`, migrate, implement the `savedQueries` contract and router.
7. Build the console page, toolbar, storage wrapper and fetcher. The GraphiQL schema is refetched when the store or version changes; tabs are not reset.
8. Build the status bar and the saved-queries plugin (GraphiQL plugin API: `title`, `icon`, `content`).
9. Match light and dark mode to the app theme through GraphiQL's theme setting and scope GraphiQL's stylesheet so it does not restyle the app shell.
10. Add `GraphQL` to navigation with an icon.
11. Write router integration tests and the Playwright test listed below, both against the fake Shopify server.
12. Measure schema load on a real store. If it exceeds five seconds, add a server-side cache of the introspection response keyed by store and API version with a 24-hour lifetime; otherwise leave the proxy uncached.
13. Manual acceptance on a dev store: build a query from the Explorer, run a mutation with variables, toggle detailed cost, switch store and version.
14. Write `docs/graphql-console.md` (permissions, what is audited, limits). Commit.

## Todo

- [ ] Bundling spike done and decision recorded
- [ ] Origin check mounted for `/api/shopify/*`
- [ ] `execute` and `versions` routes with tests; execute timeout aligned with the rewrite proxy
- [ ] Audit list filter by action prefix
- [ ] Saved queries model, routes and tests
- [ ] Console page with Explorer, toolbar and namespaced storage
- [ ] Status bar and saved-queries plugin
- [ ] Theme and stylesheet isolation
- [ ] Navigation entry
- [ ] Integration and Playwright tests green
- [ ] Schema load measured; cache decision recorded
- [ ] Manual acceptance on a dev store
- [ ] Docs written and phase committed

## Success Criteria

- Integration tests prove: a user on a custom role with only `graphql:query` runs a query; the same user sending a mutation gets 403 and the fake server records zero requests; a Member runs both; a document with a query and a mutation is classified by `operationName`; a subscription is rejected; a store from another organization returns 404; an `AuditLog` row with the documented metadata exists after each execution and none after introspection; `costDebug` reaches the upstream as the cost-debug header; a foreign `Origin` is refused.
- No response body or log line in those tests contains the store token.
- Playwright: the schema loads, the Explorer lists `shop`, `orders` and the `tagsAdd` mutation from the fake schema, ticking a field changes the editor text, running shows the response and the status bar, a reload restores tabs, a saved query can be created and reloaded.
- `pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **Monaco workers do not bundle under Turbopack.** Signal: worker errors or no autocomplete in step 1. Response: walk the decision gate; options 2 and 3 are pre-decided.
- **The Explorer plugin fails under React 19.** Signal: render error in step 1. Response: stop and replan this phase; the Explorer is the core of the requested experience and a custom tree is a larger piece of work.
- **GraphiQL styles leak into the app shell.** Signal: visual regressions outside `/graphql`. Response: load the stylesheet only on the console route and scope overrides to the console container.
- **Introspection is slow through the proxy.** Signal: step 12 measurement. Response: the cache described in step 12.

## Security Considerations

- Permission comes from the server-side parse of the document; the client cannot label a mutation as a query.
- Users with `graphql:query` can read any data the store token can read, including customer data. This is intended for an internal tool and is stated in the docs.
- Audit stores the document and the variables, by the owner's decision, for full traceability. Variables commonly carry customer data, so the audit table now holds it: every role with `audit:read` can read it (the Viewer preset includes that permission), and it must be covered by the retention policy required before public launch. The console docs say this plainly.
- The token is resolved and attached only inside the API process; headers supplied in GraphiQL's header editor are not forwarded to Shopify.
- The origin check complements the session cookie's same-site policy for the most sensitive routes.

## Next Steps

Phase 9's generic GraphQL node reuses the classifier and the store client. A rate limit per user on `execute` belongs to the public-launch work, not this plan.
