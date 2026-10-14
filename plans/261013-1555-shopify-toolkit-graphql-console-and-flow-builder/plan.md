---
title: "Shopify Toolkit: GraphQL console and flow builder"
description: "Build a developer toolkit on the wizloft-boilerplate: multi-store Shopify connections, a GraphiQL console with Explorer, and an n8n-style flow builder with durable runs."
status: in-progress
priority: P1
effort: 29d
tags: [feature, frontend, backend, database, api, auth]
blockedBy: []
blocks: []
created: 2026-10-13
---

# Shopify Toolkit: GraphQL console and flow builder

## Overview

Build a developer toolkit on the wizloft-boilerplate. A developer in an organization connects many Shopify stores, explores and runs Admin GraphQL against them in a GraphiQL console with an Explorer tree, and builds flows on a canvas (trigger, data, logic, action nodes) that run durably with a per-node, per-item trace.

Paths in phase files are relative to the repository root unless they start with `/`. Two sibling repositories are evidence sources only:

- Boilerplate (generation source): `/Volumes/anh.nguyen/Projects/AnhN/wizloft-boilerplate`
- Reference (patterns only, no EVISU business logic): `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2`

## Accepted Decisions

| Area | Decision |
|------|----------|
| Audience | Internal first, public later. Keep Organization tenancy; no marketing app or billing. |
| Scaffold | Boilerplate `saas` profile with `--apps app,api`. |
| Console | Embed `graphiql` 5 + `@graphiql/plugin-explorer`; fetcher calls an API proxy. |
| Flow engine | Own engine on `@xyflow/react`: graph JSON in Postgres, typed node registry, item-based data model. |
| Durable runs | `pg-boss` on the existing Postgres behind `JobQueueProvider`; worker runs inside `apps/api`. |
| Store access | Three credential strategies: pasted static token, OAuth install through an app registry, client-credentials through the same registry. |
| Crash semantics | At-least-once per item. Idempotent actions re-execute; non-idempotent actions interrupted mid-call are marked `UNKNOWN`, never re-executed. |
| Run concurrency | One flow run at a time per store; runs for different stores proceed in parallel. |
| Audit | Every console execution records metadata, the document and the variables. |
| Member role | Views stores, runs queries and mutations, views and runs flows. Managing connections and authoring flows need Admin, Owner or a custom role. |

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Connect and health-check many stores per organization with encrypted credentials | P1 |
| 2 | Run and explore Admin GraphQL per store with permission gating and audit | P1 |
| 3 | Build, validate, run and trace flows; the CSV order-tagging flow works end to end | P1 |
| 4 | Start flows from webhooks and schedules; extend the node catalog through the registry | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Project Foundation](./phase-01-project-foundation.md) | Pending |
| 2 | [Phase 2: Shopify Core Package and Data Model](./phase-02-shopify-core-package-and-data-model.md) | Pending |
| 3 | [Phase 3: Store Connections](./phase-03-store-connections.md) | Pending |
| 4 | [Phase 4: GraphQL Console](./phase-04-graphql-console.md) | Pending |
| 5 | [Phase 5: Durable Job Runtime](./phase-05-durable-job-runtime.md) | Pending |
| 6 | [Phase 6: Flow Engine Core](./phase-06-flow-engine-core.md) | Pending |
| 7 | [Phase 7: Flow Builder UI](./phase-07-flow-builder-ui.md) | Pending |
| 8 | [Phase 8: Flow Runs and Trace](./phase-08-flow-runs-and-trace.md) | Pending |
| 9 | [Phase 9: Triggers and Expansion](./phase-09-triggers-and-expansion.md) | Pending |

Order: 1 → 2 → 3 → 4. Phase 5 needs only phase 1 and may run beside 2–4. Phase 6 needs 2, 3 and 5. Then 7 → 8 → 9.

## Dependencies

- Node 24, pnpm 11, Docker (Postgres 17), a Shopify dev store and at least one Dev Dashboard app for manual acceptance.
- New packages: `graphiql`, `@graphiql/plugin-explorer`, `graphql`, `@xyflow/react`, `pg-boss`, `csv-parse`. The workspace carries a pnpm minimum-release-age policy (see `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`); when an install is refused, take the newest version that satisfies the policy rather than adding an exclusion.
- OAuth install and webhook triggers need a URL Shopify can reach (deployed host or tunnel).

## Success Criteria

- [ ] Stores connect by all three strategies; health check shows the shop name; another organization cannot see or use them; lost access shows reconnect-required.
- [ ] Console loads the schema, the Explorer lists queries and mutations, ticking fields builds the query, autocomplete and docs work.
- [ ] A mutation with variables returns its response, shows cost when detailed cost is on, and separates GraphQL errors from `userErrors`.
- [ ] Tabs, history and saved queries persist; a role without mutation permission is rejected at the API; every execution is audited.
- [x] The CSV flow (upload, parse, IF total > 1000, tag) can be built, saved, reopened and validated on the canvas.
- [ ] Running it tags every order correctly; a failing row does not abort others; re-running adds no duplicate tags.
- [ ] Killing the API mid-run and restarting resumes the run without re-executing finished items or surfacing unhandled `THROTTLED` errors.
- [ ] Webhook and schedule triggers start flows; new nodes register without changing the executor.

## Out of Scope

OMS features, a Shopify embedded or App Store app, Storefront API and REST, an AI assistant, an arbitrary-code node, a node marketplace, billing, a marketing site, deployment automation, and any use of the Shopify CLI's client to obtain collaborator access.

## Red Team Review

### Session — 2026-10-13

Inline adversarial pass by the planning session across four lenses (security, failure modes, assumptions, unrequested scope), with each claim checked against source. No independent reviewer agents ran; `/ak:plan red-team <plan-dir>` adds them.

**Findings:** 12 (8 accepted, 1 decided by the user, 3 rejected)
**Severity breakdown:** 0 Critical, 3 High, 9 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | New app routes fall outside the auth guard (`apps/app/proxy.ts:6` matches only `/dashboard` and `/settings`) | High | Accept | Phase 3 |
| 2 | The browser-test bootstrap assembles its own environment and could not reach a fake Shopify server (`scripts/e2e-with-db.mjs:163`) | High | Accept | Phase 3 |
| 3 | Browser calls pass the Next rewrite (`apps/app/next.config.ts:10`); a 60 s upstream timeout and a 50-domain connect request can outlive it | High | Accept | Phases 2, 3, 4 |
| 4 | Console executions would flood the single unfiltered audit list (`packages/auth/src/access-control.ts:285`) | Medium | Accept | Phase 4 |
| 5 | A 256 KB item limit sits below realistic order webhook payloads, while the webhook route accepts 5 MB (plan-internal) | Medium | Accept | Phase 6 |
| 6 | The upload route (`packages/api/src/contracts/files.ts:9`) was outside the origin check | Medium | Accept | Phase 6 |
| 7 | Navigation icons are imported from the design-system entry (`apps/app/app/app-shell-layout.tsx:10`); new ones must be exported there | Medium | Accept | Phase 3 |
| 8 | A pnpm minimum-release-age policy (`pnpm-workspace.yaml:19`) can refuse fresh dependency versions | Medium | Accept | Dependencies |
| 9 | The bulk mutation node goes beyond the literal request | Medium | User decision: keep | Phase 9 |
| 10 | Dedicated Shopify tables duplicate `IntegrationConnection` | Medium | Reject: its `config Json?` (`schema.prisma:310`) carries no encryption, expiry or relations | — |
| 11 | `JobRun` and `JobLog` stay unused | Medium | Reject: nothing reads them; the jobs router exposes provider status only (`packages/api/src/routers/jobs.ts:4`) | — |
| 12 | The worker shares the API process | Medium | Reject for internal-first: moving it out is a configuration change (Phase 5 risk) | — |

### Whole-Plan Consistency Sweep

Checked after applying findings and validation answers: connect batch size (10), item size limit (1 MB), timeout wording, audit contents, Member permissions, per-store run serialisation, and the bulk node all read the same in `plan.md` and every phase file. No unresolved contradiction.

## Validation Log

### Session 1 — 2026-10-13
**Trigger:** Post-draft validation of the hard-mode plan.
**Questions asked:** 4

#### Questions & Answers

1. **[Architecture]** What should the audit log store for each GraphQL execution in the console?
   - Options: Metadata + query document (Recommended) | Metadata only | Query and variables
   - **Answer:** Query and variables
   - **Rationale:** Decides what customer data the audit table holds and who can read it.
2. **[Assumptions]** What may the default Member role do with stores?
   - Options: View stores + run queries (Recommended) | Add mutations and running flows | View only
   - **Answer:** Add mutations and running flows
   - **Rationale:** Sets the role presets in the permission catalog and the test matrix.
3. **[Tradeoffs]** How do several flow runs for the same store execute?
   - Options: One run at a time (Recommended) | In parallel
   - **Answer:** One run at a time
   - **Rationale:** Selects the queue policy and the rate-limit strategy.
4. **[Scope]** The bulk operation node was added by the planner, not requested. Keep it?
   - Options: Defer until needed (Recommended) | Keep in phase 9
   - **Answer:** Keep in phase 9
   - **Rationale:** Keeps batch-mode execution and step state in the engine design.

#### Confirmed Decisions
- Audit stores document and variables: full traceability chosen over minimising stored customer data.
- Member preset gains `graphql:mutate` and `flows:run`; `stores:manage` and `flows:manage` stay with Admin, Owner and custom roles.
- Runs are serialised per store.
- The bulk mutation node stays in scope.

#### Action Items
- [x] Phase 4: audit metadata includes variables; security note rewritten
- [x] Phase 2 and Phase 6: Member preset updated
- [x] `plan.md`: decisions table updated

#### Impact on Phases
- Phase 2: `MEMBER_PERMISSIONS` gains `graphql:mutate`.
- Phase 4: variables stored in audit metadata, with a 1 MB input cap; tests use a custom role for the query-only case.
- Phase 6: `MEMBER_PERMISSIONS` gains `flows:run`.
- Phases 5, 6, 9: unchanged; the answers confirm the drafted design.

### Verification Results
- Claims checked: 41
- Verified: 34 | Failed: 0 | Unverified: 7
- Tier: Full
- Sources read directly: the boilerplate generator, API contracts and routers, access-control catalog, auth permissions, Prisma schema, jobs and storage packages, app shell, proxy and Next config, the e2e bootstrap; the reference project's Shopify package and workflow engine; npm metadata for `graphiql`, `@graphiql/plugin-explorer`, `@xyflow/react` and `pg-boss`; Shopify documentation for client credentials and offline tokens.
- Not verifiable until implementation, each carried as a named step or risk in its phase: the refresh grant's exact `grant_type`, the rewrite proxy timeout value, multipart support through oRPC, the `publicApiVersions` query, pg-boss heartbeat behaviour after a crash, Shopify's acceptance of an `http://localhost` redirect, and bulk mutation limits.

### Whole-Plan Consistency Sweep
No stale terms remain after propagation. See the sweep under Red Team Review.

<!-- slug: shopify-toolkit-graphql-console-and-flow-builder -->
