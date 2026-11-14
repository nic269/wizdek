# Native Wizdek route migration — 2026-11-14

## Accepted correction

The user clarified that OMS management must be a route of `apps/app` on localhost:4000, with **Works → OMS management** in the shared navigation, including **Debug logs** and **Settings → Site config**. Components must use the existing shadcn/design-system components and styling. This supersedes the separate app, port 4010 and independent deployment decision in the original plan.

## Current architecture

- Native catch-all page: `apps/app/app/works/oms-management/[[...view]]/page.tsx`.
- OMS-specific code, components, tests, policy, queries and scripts: `apps/app/app/works/oms-management/_module/`.
- Native guarded handlers: `apps/app/app/works/oms-management/api/`.
- Shared Wizdek `AppShellLayout`, nested navigation and design-system primitives. No separate sidebar, global stylesheet, iframe or proxy is used.
- Backend identity is the existing Wizdek session helper through one module-local adapter. Page and API apply the same OMS eligibility check. Auth revocation cookies are forwarded; API 401 clears the isolated management cache/UI immediately.
- Environment selection is per-tab URL state via `?profile=...`. Immutable profile revisions, DB isolation, confirmations, backup evidence, command receipts and recovery remain in place.
- `/oms` and `/oms/e/<profile>` are compatibility redirects to the native route. The old 4010 process is stopped; no standalone workspace package, image, Compose or Caddy route remains in source.
- Old ignored runtime/cache/environment files were left untouched. Existing real control data must be backed up and explicitly reused/restored with its key before operating on it from `apps/app`.

## Shared changes and removal boundary

Generic `AppShell` supports nested nav items; Works has an OMS child. The shared shell accepts a per-page organization requirement and sign-in callback so this independently scoped tool does not require a Shopify organization. Other pages keep their previous defaults. The generic post-login document navigation and identity endpoint remain reusable platform behavior.

Native Next config only adds `pg` as a server external; the development proxy was removed. App dependencies/scripts and lockfile now own management tooling. Module isolation permits the shared design system and one generic auth adapter, while rejecting shared OMS backend dependencies.

Removal rehearsal deletes the route/module, compatibility alias, OMS navigation block and dedicated CI/scripts from a temporary source copy. It preserves generic shell/auth behavior and verifies the surviving Wizdek app without OMS runtime variables.

## Verification evidence

- Main Wizdek app unit suite: **64 passed**, including native identity/policy and revocation-cookie regressions.
- OMS module unit suite: **34 passed**; disposable PostgreSQL integration: **13 passed**; isolated Chromium UI harness: **6 passed**, including cancelling a dirty environment switch without changing its displayed value.
- Shared navigation/config suite: **7 passed**, including the Works child link.
- App typecheck, workspace boundary check and module-isolation check pass.
- Native app production build passes; route output includes Works, native management pages and guarded APIs. Build uses dummy database/auth values and no live OMS connection.
- Removal rehearsal passes: surviving Wizdek build, generic auth/API types/tests and boundaries without OMS runtime configuration.
- Read-only HTTP checks: native pages redirect to Wizdek sign-in with the precise relative callback; unauthenticated native API returns 401; health returns 200; old `/oms` returns a redirect to the native path.
- Browser verification with the real local app confirms the unauthenticated sign-in redirect. Authenticated component behavior is checked separately in a test-only harness; it is not a claim of live operator or provider parity.
- Independent security review confirmed page/API eligibility, exact-origin mutation protection, revocation headers and immediate cache teardown. UI simplification replaced the standalone controls/styles with shared design-system components.

## Deployment and legacy state

No live DB schema/data migration, commit, push or deployment was performed. All legacy OMS roles, assignments, routes and tools remain intact. Shared login still requires no OMS users/sessions/password changes.

The management control store still requires one owning process and persistent storage. Because management is now native, its runtime configuration belongs to `apps/app`; do not scale the owner across a shared SQLite volume without redesigning storage. Staging/production connection setup, live shared-login/provider parity, backup restore and operator UAT remain prerequisites for legacy retirement.

See the [native module README](../../apps/app/app/works/oms-management/_module/README.md) for routes, commands, configuration and removal details. The plan remains in-progress for the remaining live rollout and retirement gates.

## Simple connection follow-up — 2026-11-14

The user requested the same connection experience as Wizdek Database for a single operator. New connections now use Name, masked Database URL, Environment and Test & save. IDs are generated; account IDs and a specially restricted PostgreSQL role are no longer prerequisites. The supplied database role determines available reads. Connection credentials remain encrypted and server-only. Destination allowlists are optional; login/operator authorization, target isolation, production classification and write gates remain enforced.

Account-specific tools load OMS workspace accounts after connecting and show workspace names with member emails. Database-wide diagnostics do not require an OMS account selection. Business commands still require the optional OMS API bridge.

With the user's URL entered directly in the browser, OMS Staging was saved successfully on localhost:4000. Live read-only verification loaded 50 debug log rows, Site config and the account chooser. No OMS database grants, schema, roles or data were changed. Writes remain disabled; live provider actions, production setup and legacy retirement remain outstanding.

Validation for this follow-up: 43 module unit tests, 13 disposable PostgreSQL integration tests and 8 UI tests passed. The connection creation test also passed after adding automatic navigation to the saved profile. Biome checked 60 module/API files successfully. This follow-up does not claim a new production build or deployment.
