# OMS Management in Wizdek — Read-only research

> Snapshot trước validation. Chỉ dùng source evidence; các khuyến nghị independent auth, API-only access, packages/oms-* và port toàn bộ OMS trong báo cáo này đã bị thay thế. Authority là plan.md/architecture.md: shared Wizdek login, direct DB diagnostics, editable/custom profiles, toàn bộ management-specific source trong app. Không triển khai các đề xuất cũ bên dưới.

Conducted: 2026-11-14 (Asia/Ho_Chi_Minh)

## Contents

- [Outcome](#outcome)
- [Scope and evidence](#scope-and-evidence)
- [Recommended architecture](#recommended-architecture)
- [Feature scope for the implementation plan](#feature-scope-for-the-implementation-plan)
- [Unresolved questions](#unresolved-questions)

## Outcome

Add `apps/oms-management` as an isolated product surface in the Wizdek monorepo, backed by a typed HTTP bridge to independently deployed OMS API targets. Keep the target toolkit database and auth untouched; let the OMS API remain the only owner of OMS database writes, Shopify/DHL credentials, queues, workflow side effects, and fraud transitions. The UI can switch between preconfigured `staging` and `production` target descriptors, but must never accept arbitrary URLs, SQL, or credentials from the browser.

This is the lowest-risk fit for the stated requirements: independent deploy/auth, runtime environment switching, and uninstalling OMS without breaking the other toolkit apps/packages.

## Scope and evidence

### Target Wizdek baseline

- The target currently has only `apps/app` and `apps/api` as product apps; its workspace includes `apps/*` and `packages/*` (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/pnpm-workspace.yaml:1-3`). A new `apps/oms-management` is therefore a clean app boundary, not a rename of an existing app.
- The target app uses one browser `QueryClient` for the whole tree (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/apps/app/app/providers.tsx:3-17`) and its shared queries already key organization lists by `organizationId` (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/apps/app/app/lib/queries.ts:7-18`). OMS queries need a separate provider or an `oms + environment + account` key namespace.
- The target database client is a single global Prisma client backed by `DATABASE_URL` (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/packages/database/src/client.ts:1-24`). Its auth adapter uses the same client and the same database (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/packages/auth/src/auth-options.ts:54-70`). Importing OMS Prisma/auth into this client would violate the requested isolation.
- The target's Next rewrite sends `/api/*` to one configured `API_INTERNAL_URL`/`NEXT_PUBLIC_API_URL` (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/apps/app/next.config.ts:5-20`). A bridge should select among allow-listed target API origins server-side, not rewrite browser traffic to a user-provided origin.
- Target boundaries explicitly make `@repo/database`, `@repo/auth`, `@repo/shopify`, `@repo/flows`, `@repo/jobs`, and `@repo/storage` server-only (`/Volumes/anh.nguyen/Projects/wizloft/shopify-toolkit/boundaries.config.json:1-49`). Keep OMS code in its own package(s) and expose only client-safe contract/types to the browser.

### OMS G_ADMINISTRATOR inventory

The source OMS has a role-code gate in addition to module permissions. The following are the focused G_ADMIN-only capabilities that must be represented in the new product scope:

| Capability | UI | API / operational boundary |
|---|---|---|
| Debug Logs | `/debug/workflows` is hidden from non-G_ADMIN and redirects non-G_ADMIN to dashboard (`apps/web/components/app/app-sidebar.tsx:32-42,122-129`; `apps/web/app/(authenticated)/debug/workflows/page.tsx:1-10`). | Every route is `requireAuth + requireRole(G_ADMINISTRATOR)` (`apps/api/src/routes/debug-workflows.ts:15-18`). List/detail filters expose workflow metadata, actors, error/warn logs, shop domains, and original import-file download routes (`apps/api/src/routes/debug-workflows.ts:31-60,63-132,134-211`). Treat this as privileged diagnostic data, not a generic log viewer. |
| Site Config | Settings tabs include General, Roles & Permissions, Email Mapping, Shopify Integrations, Workflow Rules, and the G_ADMIN-only Site Config tab (`apps/web/components/settings/settings-tabs.tsx:14-25`). Site Config renders Maintenance, Shopify Apps/general config, and Cronjobs (`apps/web/app/(authenticated)/settings/site-config/page.tsx:7-16`). | Maintenance and Cronjobs are G_ADMIN-only (`apps/api/src/routes/site-config-maintenance.ts:34-49`; `apps/api/src/routes/site-config-cronjobs.ts:12-16`). Shopify app config requires `SETTINGS:MANAGE_SITE_CONFIG` and redacts the encrypted client secret (`apps/api/src/routes/site-config-shopify-apps.ts:34-50,134-152`). |
| Shopify secret operations | Shopify Integrations passes `roleCode` to conditionally render webhook-signature/raw-token controls (`apps/web/components/settings/shopify-integration-config-drawer.tsx:60-63`). | Raw access token is fetched/decrypted only for G_ADMIN (`apps/api/src/routes/shopify-stores.ts:212-230`); webhook signature is stored encrypted and only accepted/decrypted for G_ADMIN (`apps/api/src/routes/shopify-stores.ts:293-299,423-456`). Never proxy these values to the client except an explicit, audited reveal operation. |
| DHL privileged artifacts | Import/Export includes DHL label export/download UI (`apps/web/app/(authenticated)/import-export/import-export-client.tsx:17-21`). | Normal labels/invoices require `IMPORT_EXPORT:VIEW_HISTORY`; waybill and remote DHL document-image retrieval are G_ADMIN-only (`apps/api/src/routes/dhl-labels.ts:23-30,60-64,102-164,166-261`). The admin row lookup is not workspace-scoped (`apps/api/src/routes/dhl-labels.ts:269-278`), so the bridge must preserve the source API's privileged endpoint and never reimplement it as a broad client query. |
| Fraud risk review | Fulfillments renders fraud board and only enables risk review when role is G_ADMIN plus edit permission (`apps/web/app/(authenticated)/fulfillments/page.tsx:13-34`). | Risk review requires both `FULFILLMENTS:EDIT` and G_ADMIN; fraud contact/process use `FULFILLMENTS:RUN` and account scope (`apps/api/src/routes/fulfillments.ts:354-382,471-484`). Keep these as command endpoints with server-side state/eligibility checks. |

The rest of the OMS sidebar is permission-driven (Orders, Fulfillments, Shipments, Returns, Import/Export, Settings) while Debug Logs alone is explicitly `requiresGod` (`apps/web/components/app/app-sidebar.tsx:32-42,122-129`). The plan should port the visible product sections, but retain role and module checks at the OMS API rather than trusting UI visibility.

### Import, storage, and scheduler constraints

- Import history is account-scoped and limited to 20 batches; rows and notification summaries are joined server-side (`apps/api/src/routes/import-batches.ts:53-101`). CSV uploads are capped at 5 MB and PDF uploads at 9 MB (`apps/api/src/routes/import-batches.ts:38-40,104-127,319-355`).
- Supported import execution checks workflow-rule state before accepting an upload (`apps/api/src/routes/import-batches.ts:319-341`). The UI polls `READY`/`PROCESSING` batches every 3 seconds (`apps/web/app/(authenticated)/import-export/import-export-client.tsx:68-136`). Preserve polling and status semantics in the bridge.
- Original files may be object-storage backed or DB text; debug download reconstructs CSV when no original file exists (`apps/api/src/routes/debug-workflows.ts:137-211`). Do not expose storage keys or generate client-side SQL/file URLs.
- Cronjob control is live and audited: schedule updates validate five-field cron, write config/audit, and wake the scheduler; start/stop/run-now are commands (`apps/api/src/routes/site-config-cronjobs.ts:70-137`). Model them as mutations with invalidate/refetch, not optimistic state-only toggles.
- OMS production secrets are API-side concerns: `BETTER_AUTH_SECRET`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, Mandrill variables, DHL API URL/authorization, and private S3 settings are named in the source examples (`apps/api/env.example:5-60`). Do not copy values or put these variables in the Wizdek browser/app environment.

## Recommended architecture

```text
Wizdek browser
  └─ apps/oms-management (UI + server-only bridge)
       ├─ target descriptor: staging | production (allow-list only)
       ├─ OMS QueryClient / cache namespace
       └─ typed bridge: session + selected environment → OMS API
             ├─ OMS staging deploy → staging OMS DB + Shopify/DHL/storage/jobs
             └─ OMS production deploy → production OMS DB + Shopify/DHL/storage/jobs

Wizdek toolkit DB/auth remains owned by apps/app + apps/api.
OMS DB/auth remains owned by the OMS API deployment.
```

### Bridge rules

1. Define a server-only `OmsEnvironment` union (`staging | production`) and a static descriptor map containing API origin, expected audience/issuer, and display metadata. Reject all other values.
2. Forward the current user's authenticated identity through an explicit, documented bridge contract. Do not share `BETTER_AUTH_SECRET`, decrypt OMS session cookies in Wizdek, or silently accept a second cookie as equivalent. The preferred contract is a short-lived, signed handoff/token exchange that the OMS API verifies with an asymmetric public key; fallback is a user-authenticated OMS session established through the OMS API origin.
3. Keep OMS API calls typed and endpoint-specific: list/query endpoints for reads; command endpoints for imports, fraud transitions, Shopify sync, DHL documents, cron control, and secret reveal. Return redacted DTOs only.
4. Do not make raw SQL a bridge. OMS routes contain authorization, account scoping, transactions, workflow rules, queueing, Shopify/DHL calls, encrypted credentials, and audit writes. SQL cannot safely reproduce those invariants. At most, an isolated read-only diagnostics adapter may query a versioned view after explicit approval.
5. For uninstallability, keep OMS UI, API client, DTOs, environment descriptors, and tests under `apps/oms-management` plus `packages/oms-management-contract` (or an equivalent `packages/oms-management` package). No existing `@repo/*` package should import OMS code. Removing the app/package and its route registration must leave `apps/app`, `apps/api`, `@repo/database`, and existing toolkit flows buildable.

### Runtime DB/API switching

There are two viable deployment shapes:

| Rank | Shape | Fit | Risk / trade-off |
|---|---|---|---|
| 1 | One OMS API deployment per environment; UI switches between two allow-listed API origins | Best fit for independent deploy/auth and safe environment isolation; each API owns one DB/client pool and its side effects | Requires two OMS deployments and a secure identity handoff; adds deployment/config work |
| 2 | One API process with two preconfigured OMS Prisma clients/pools and two API target descriptors | Works when both DBs must be reachable from one process; Prisma supports separate clients/configs | More pool capacity and accidental cross-target risk; migrations and health checks must run per target |
| 3 | Browser-selected DB URL/raw SQL | Reject | Leaks credentials, bypasses auth/transactions/audit/external providers, and makes environment confusion likely |

For shape 1, the UI sends an environment-aware request to its server bridge, and the bridge selects `OMS_STAGING_API_URL` or `OMS_PRODUCTION_API_URL`. For shape 2, use separate generated clients/modules and explicit `stagingDb`/`productionDb`; never mutate a singleton client's connection string at runtime.

Prisma's primary documentation says an application should generally reuse one `PrismaClient` because each instance owns a connection pool ([Prisma: instantiating Prisma Client](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/instantiate-prisma-client)); its connection-pool guidance reiterates that pools are created per client/driver and should be sized across all instances ([Prisma: connection pool](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool)). Prisma's multiple-database guide documents separate contracts/configs/clients and separate connection variables when one app must access multiple databases ([Prisma: multiple databases](https://www.prisma.io/docs/guides/database/multiple-databases)). These sources support shape 2 technically, but shape 1 is safer operationally because production credentials and side effects stay in the production OMS deployment.

### Query cache isolation

Prefer a nested OMS `QueryClientProvider` around the OMS surface, with query keys shaped like:

```ts
["oms", environment, omsAccountId, "fulfillments", filters]
```

On environment/account switch, cancel and remove the previous OMS queries before loading the new target. Also include the environment in mutation invalidation filters. TanStack Query documents that `QueryClient` owns its `QueryCache` ([QueryClient reference](https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryClient)), `QueryClientProvider` supplies the client to a subtree ([QueryClientProvider](https://tanstack.com/query/latest/docs/framework/react/reference/functions/QueryClientProvider)), and every variable affecting a query must be in its key ([Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)). Keys are not authorization: the OMS API must authorize every read and mutation. For a same-tree implementation, the minimum safe fallback is a mandatory `oms/environment/account` prefix plus explicit cache removal on switch.

## Feature scope for the implementation plan

1. `apps/oms-management` shell, route guard, environment switcher, OMS-specific QueryClient, error/loading/read-only states, and typed bridge.
2. OMS navigation and permissions: Orders, Fulfillments/Fraud, Shipments, Returns, Import/Export, Settings tabs, and G_ADMIN Debug Logs/Site Config.
3. Privileged controls as typed mutations: maintenance exceptions, Shopify app settings, cron start/stop/run-now, Shopify connection health/sync, raw secret reveal (if retained), DHL waybill/documents, fraud risk review.
4. Import surfaces: type/template discovery, CSV/PDF upload limits, background batch status polling, history, generated exports, and private-file downloads.
5. Tests: environment allow-list and cache isolation; bridge auth failures; G_ADMIN vs non-G_ADMIN matrix; account scoping; secret redaction; import size/status transitions; DHL artifact permissions; fraud command permissions; uninstall/build boundary check.

## Unresolved questions

- Should the OMS keep its existing Better-Auth users/sessions as the source of truth, or should Wizdek accounts be exchanged into OMS sessions? This changes the handoff protocol and cookie/origin setup.
- Are staging and production OMS databases physically separate, or are they schemas/tenants in one Postgres server? The answer determines whether shape 1 is mandatory and how backups/migrations are isolated.
- Is raw access-token reveal still required in the new UI? If yes, require an explicit audited reveal route with no React Query persistence; otherwise omit it and preserve only redacted health/scope metadata.
- Is `apps/oms-management` expected to be a separate deployable app artifact or a route inside `apps/app`? A separate app is the safer interpretation of “independent deploy,” but it needs its own Docker/Turbo target and hosting entry.
