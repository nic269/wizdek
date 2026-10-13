---
phase: 3
title: "Phase 3: Store Connections"
status: todo
priority: P1
effort: "3.5d"
dependencies: [2]
---

# Phase 3: Store Connections

## Context Links

- Contract and router pattern: `packages/api/src/contracts/files.ts`, `packages/api/src/routers/files.ts`, registration in `packages/api/src/contracts/index.ts` and `packages/api/src/routers/index.ts`
- Authorization helpers to share: `requireUser` and `requireOrganizationPermission` in `packages/api/src/routers/organizations.ts`
- Plain Hono route precedent: the `/api/auth/*` handler in `packages/api/src/app.ts`
- Client panel pattern: `apps/app/app/dashboard/organizations-panel.tsx`
- Navigation: `packages/config/src/navigation.ts`, icons in `apps/app/app/app-shell-layout.tsx`
- evisu connect flow for reference: `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/apps/api/src/routes/shopify-oauth.ts`, `shopify-stores.ts`

## Overview

Expose the app registry and store connections through the API and the app UI. A user with `stores:manage` can register a Shopify app once, then connect stores by pasted token, OAuth install or client credentials, see their health, and reconnect or disconnect them.

## Key Insights

- The app has no global "active organization": each panel keeps its own selector in local state (`members-panel.tsx`). Every toolkit page is organization-scoped, so this phase introduces one shared active-organization context.
- Shopify offers no API to reach every store a Partner account can open. The supported equivalent is the app registry: register one app, then add stores under it. Stores in the app's own organization connect by typing a domain (client credentials); other stores install through OAuth.
- An OAuth callback can arrive two ways: with `code` and our `state` (authorization-code flow we started), or with `id_token` and no state (managed install). The second cannot be tied to an organization on its own, so completion always happens in an authenticated request from the app.
- The OAuth redirect URL sits on the app origin (`/api/shopify/oauth/callback`) because Next rewrites `/api/*` to the API.

## Requirements

Functional:

- App registry: list, create, update (rename, rotate secret, change token mode), delete (refused while stores reference the app).
- Connect by static token: domain + token, verified by a health check before the store is saved as `CONNECTED`.
- Connect by client credentials: app + one or many domains (up to 10 per request, processed five at a time; the UI sends longer lists in chunks), each with its own result. <!-- Updated: Red Team Review - request stays under the rewrite proxy timeout -->
- Connect by OAuth: begin (creates a `PENDING` store and returns the authorize URL and the app's install link) and complete.
- Health check on demand; disconnect (delete tokens, status `DISCONNECTED`); reconnect by repeating any connect action for the same domain.
- Stores page shows name, domain, strategy, status, scopes and last health check.

Non-functional:

- Every store-scoped route derives the organization from the store row and returns 404 for a store outside the caller's organizations.
- No response contains a token or secret; apps expose `hasClientSecret: true` instead.
- Connection events are written to `AuditLog`.
- Pages under `/stores`, `/graphql` and `/flows` redirect signed-out visitors to sign-in. The auth guard in `apps/app/proxy.ts` currently matches only `/dashboard` and `/settings`. <!-- Updated: Red Team Review - new routes were outside the auth guard matcher -->

## Architecture

Routes (oRPC contracts, all require a session):

| Operation | Method and path | Permission |
|-----------|-----------------|------------|
| `shopifyApps.list` | GET `/api/organizations/{organizationId}/shopify/apps` | `stores:read` |
| `shopifyApps.create` / `update` / `delete` | POST, PATCH, DELETE under the same prefix | `stores:manage` |
| `shopifyStores.list` | GET `/api/organizations/{organizationId}/shopify/stores` | `stores:read` |
| `shopifyStores.get` | GET `/api/shopify/stores/{storeId}` | `stores:read` |
| `shopifyStores.connectStaticToken` | POST `/api/organizations/{organizationId}/shopify/stores/static-token` | `stores:manage` |
| `shopifyStores.connectClientCredentials` | POST `.../stores/client-credentials` | `stores:manage` |
| `shopifyStores.beginOAuth` | POST `.../stores/oauth` | `stores:manage` |
| `shopifyStores.completeOAuth` | POST `/api/shopify/oauth/complete` | `stores:manage` on the resolved store |
| `shopifyStores.checkHealth` | POST `/api/shopify/stores/{storeId}/health-check` | `stores:read` |
| `shopifyStores.disconnect` | DELETE `/api/shopify/stores/{storeId}` | `stores:manage` |

One plain Hono route, registered in `app.ts` before the oRPC catch-all: `GET /api/shopify/oauth/callback` validates the `shop` parameter and redirects to `${NEXT_PUBLIC_APP_URL}/stores/oauth/callback?<raw query>`. It performs no state change.

OAuth completion (`completeOAuth`, input: raw query string and optional `storeId`):

```text
parse query -> normalise shop
resolve store: by state hash (unconsumed, unexpired, created by this user)
               else by storeId, else the single PENDING store for this shop the user can manage
load app credentials -> verify HMAC of the raw query
if id_token: verify signature, audience, expiry, destination shop
exchange (adapter chosen by presence of code or id_token; expiring flag from app.tokenMode)
persist token, consume state, run health check -> CONNECTED, audit
```

Authorize URL: `https://{shop}/admin/oauth/authorize?client_id=…&scope=…&redirect_uri={APP_URL}/api/shopify/oauth/callback&state=…`. State is 32 random bytes, stored hashed, valid 10 minutes, single use.

UI (`apps/app`):

- `app/lib/active-organization.tsx`: context provider and hook; value persisted in `localStorage`, defaulting to the first organization; a switcher rendered in the `AppShell` top bar.
- `/stores`: table of stores with status badges and row actions (health check, reconnect, disconnect).
- `/stores/new`: three tabs, one per strategy. The OAuth tab shows the exact redirect URL to add to the Shopify app configuration.
- `/stores/apps`: app registry list and form.
- `/stores/oauth/callback`: posts the query to `completeOAuth`, lets the user pick a pending store when several match, then returns to `/stores`.

## Related Code Files

- Create: `packages/api/src/routers/authz.ts`, `packages/api/src/contracts/shopify-apps.ts`, `packages/api/src/contracts/shopify-stores.ts`, `packages/api/src/routers/shopify-apps.ts`, `packages/api/src/routers/shopify-stores.ts`, `packages/api/src/shopify-oauth-callback.ts`, and router tests beside them
- Create: `packages/shopify/src/stores/connect-store.ts`, `packages/shopify/src/stores/oauth-connection.ts`, `packages/shopify/src/stores/audit.ts`
- Create: `apps/app/app/lib/active-organization.tsx`, `apps/app/app/stores/page.tsx`, `stores-panel.tsx`, `apps/app/app/stores/new/page.tsx`, `connect-store-form.tsx`, `apps/app/app/stores/apps/page.tsx`, `shopify-apps-panel.tsx`, `apps/app/app/stores/oauth/callback/page.tsx`, `oauth-callback.tsx`
- Create: `tests/e2e/stores.spec.ts`, `docs/decisions/0002-organization-store-enumeration.md`
- Modify: `packages/api/src/routers/organizations.ts` (import the shared helpers), `packages/api/src/contracts/index.ts`, `packages/api/src/routers/index.ts`, `packages/api/src/app.ts`, `packages/api/package.json`
- Modify: `packages/config/src/navigation.ts` and its test, `apps/app/app/app-shell-layout.tsx`, `apps/app/app/layout.tsx`, `apps/app/proxy.ts`
- Modify: `scripts/e2e-with-db.mjs`, `playwright.config.ts` (start the fake Shopify server and pass its URL and the encryption key to the API process)

## Implementation Steps

1. Move `requireUser` and `requireOrganizationPermission` from `routers/organizations.ts` into `routers/authz.ts` and add `requireStorePermission(headers, storeId, module, action)`, which loads the store, checks permission on its organization, and throws `NOT_FOUND` when the store is missing or outside the caller's organizations. The organizations router keeps its behaviour and its tests stay green.
2. Write the two contract files with Zod schemas. Output schemas list fields explicitly; none carries a secret.
3. Implement connect services in `@repo/shopify`: each validates the domain, obtains a token for its strategy, runs the health check, and writes the store (API version initialised from the package default), token and audit entry in one transaction.
4. Implement `beginOAuth` and `completeOAuth` as specified above.
5. Add the callback redirect route to `app.ts` and a test asserting it rejects a `shop` value that is not a `myshopify.com` domain.
6. Implement the routers and register contracts and routers. Regenerate and check the OpenAPI document test.
7. Spike, time-boxed to two hours: look for a supported API that lists every store of a Shopify organization. Record the finding in `docs/decisions/0002-organization-store-enumeration.md`. If one exists, add an "import from organization" action that feeds `connectClientCredentials`; otherwise the multi-domain input is the delivered path.
8. Build the active-organization provider and switcher; mount the provider in `apps/app/app/layout.tsx`.
9. Build the stores, new-store, app-registry and callback pages using the `apiClient` and local-state pattern of `organizations-panel.tsx`. Wrap each page in `AppShellLayout` and extend the matcher in `apps/app/proxy.ts` with `/stores/:path*`, `/graphql/:path*` and `/flows/:path*`.
10. Add `Stores` to `createDashboardNav` and an icon branch in `getDashboardNavIcon`; update `navigation.test.ts`. `app-shell-layout.tsx` imports its icons from `@repo/design-system`, so export any new icon from that package's entry first.
11. Write router integration tests against Postgres and the fake Shopify server (list below). Extend `scripts/e2e-with-db.mjs`, which assembles the environment for the browser suite itself, to start the fake server and pass `SHOPIFY_ADMIN_BASE_URL_OVERRIDE` and `SHOPIFY_TOKEN_ENCRYPTION_KEY`. Then write a Playwright test that connects a store by static token through the UI. <!-- Updated: Red Team Review - browser suite could not reach a fake Shopify server -->
12. Manual acceptance on a real dev store: connect once by each strategy; revoke access in Shopify and confirm the status changes after a health check.
13. Document setup in `docs/stores.md` (creating a Dev Dashboard app, redirect URL, which strategy fits which store). Commit.

## Todo

- [ ] Shared authorization helpers extracted; existing organization tests green
- [ ] App registry contracts, routers and tests
- [ ] Static-token, client-credentials and OAuth connect paths
- [ ] OAuth callback redirect route
- [ ] Organization-store enumeration spike recorded
- [ ] Active-organization context and switcher
- [ ] Stores, new-store, app-registry and callback pages
- [ ] Navigation entry
- [ ] Integration and Playwright tests green
- [ ] Manual acceptance on a dev store for all three strategies
- [ ] Docs written and phase committed

## Success Criteria

- Integration tests prove: each strategy ends `CONNECTED` with the shop name stored; a member without `stores:manage` receives 403 on every write; a user from another organization receives 404 for `get`, `checkHealth` and `disconnect`; an invalid domain is rejected with 422 before any outbound request; a replayed or expired state is rejected; a tampered HMAC is rejected; a 401 from Shopify yields `RECONNECT_REQUIRED`.
- A serialised scan of every response body in those tests contains none of the token or secret values used.
- A signed-out request for `/stores` is redirected to `/sign-in`.
- `pnpm test`, `pnpm test:e2e:db`, `pnpm check-types`, `pnpm boundaries` and `pnpm build` exit 0.
- Manual acceptance checklist for the three strategies is ticked with the store domains used.

## Risk Assessment

- **Shopify refuses an `http://localhost` redirect URL.** Signal: the authorize page reports an invalid redirect. Response: run OAuth acceptance through a tunnel or the deployed host; static-token and client-credentials paths are unaffected.
- **Managed install delivers parameters this flow does not expect.** Signal: `completeOAuth` cannot pick an adapter. Response: capture the query (without secrets), extend the adapter selection; the two-step completion design already tolerates it.
- **No enumeration API exists.** Expected outcome. Response: ship the multi-domain input only.

## Security Considerations

- State is hashed at rest, single use, bound to the creating user and the pending store.
- The callback route redirects only to the configured app URL and ignores any caller-supplied return target.
- `completeOAuth` requires a session and `stores:manage`, so a callback URL alone cannot attach a token to an organization.
- Tokens and secrets are write-only through the API. Rotating an app secret marks its OAuth stores for a health check.
- Organization is always derived from the store row for store-scoped routes, never taken from input.

## Next Steps

Phase 4 uses `requireStorePermission` and the store client to proxy GraphQL. Phase 9 adds a webhook signing secret to static-token stores.
