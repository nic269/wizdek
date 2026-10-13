---
title: Shopify Toolkit phases 1-9 implemented
date: 2026-10-13
summary: "All nine plan phases are coded, tested and committed on main; real-store manual acceptance is still open."
---

# Shopify Toolkit phases 1-9 implemented

## What happened

The plan `261013-1555-shopify-toolkit-graphql-console-and-flow-builder` was implemented through `/ak-cook`, phase by phase, each with its own commits on `main`.

- Phase 1: scaffold from the Wizloft boilerplate (`saas`, apps `app,api`). Postgres for this project runs on port 5440 because 5432 belongs to the meldmark project.
- Phase 2: `@repo/shopify` (Admin client, secret encryption, OAuth, three credential strategies, token renewal under a Postgres advisory lock).
- Phase 3: store connections API and UI, app registry, shared active-organization switcher.
- Phase 4: GraphQL console on GraphiQL 5 with the Explorer; audited proxy, saved queries, status bar.
- Phase 5: pg-boss job provider and throttle-aware Shopify retry.
- Phase 6: `@repo/flows` engine (definition, validation, item-based executor with checkpoints), flows and runs API, CSV upload.
- Phase 7: flow list and canvas builder on `@xyflow/react`.
- Phase 8: run dialog, runs list, run trace; a test that kills the real API process mid-run and restarts it.
- Phase 9: webhook and schedule triggers with per-store activation; filter, switch, set-fields, GraphQL request and bulk mutation nodes.

## Findings worth keeping

- GraphiQL 5 and `graphiql-explorer` 0.9 work under Next 16 (Turbopack) and React 19 with `graphiql/setup-workers/webpack`; no bundler override was needed (decision 0003).
- pg-boss `key_strict_fifo` keeps a key blocked after a permanently failed job. The provider fails such a job into a dead-letter queue and deletes it so the store's next run can start (decision 0004).
- Crash recovery in pg-boss needs both `monitorIntervalSeconds` and `superviseIntervalSeconds` lowered to be fast; with defaults a dead worker's job returns after about 60 seconds.
- A test that kills a worker must spawn it as a single Node process. Killing a `pnpm exec` wrapper leaves the real worker alive and heartbeating, which made the crash test fail for the wrong reason.
- Shopify's `webhookSubscriptionCreate` input now uses `uri`; `callbackUrl` is deprecated.
- The engine needed two extensions for phase 9 (batch mode, and repeat-safety that depends on config). They went in a separate commit before the node commits, so the four item-mode nodes were added without touching `packages/flows/src/engine/`.
- Integration suites share one database and run in parallel across packages, so assertions must count only their own rows.
- The scaffold's `scripts/env/turbo-env-contract.test.ts` fails as generated (`NEXT_PUBLIC_DOCS_URL` is listed in `turbo.json` without a docs app). It is not part of `pnpm test` and was left alone.

## Verification

`pnpm check:ci`, `check-types`, `test`, `boundaries`, `build`, `test:integration` and `test:e2e:db` pass. The process-level kill-and-restart test passed three consecutive times. A one-off 10,000-row run against the fake store finished in 48 seconds; run detail loaded in 16 ms and item pages in 5 to 16 ms.

## Open

- Manual acceptance on a real Shopify dev store for phases 3, 4, 8 and 9, and the real-store schema load measurement for phase 4. These need the owner's store and app credentials, so the plan stays in progress.
- Retention for audit and run data before any use beyond internal.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
