---
phase: 2
title: "Profiles, revisions và runtime switching"
status: in-progress
priority: P2
effort: "4d"
dependencies: [1]
---

# Phase 2: Profiles, revisions và runtime switching

## Goal
Switch staging/production/custom DB without mixing connections, cache, forms or operations.

## Files to create / modify
App server/storage/, migrations/control/, server/profiles/{repository,crypto,validation,network-policy}.ts, server/target/{context,clients,leases,compatibility}.ts, server/db/, prisma/oms/schema.prisma, generated/oms/, components/{environment-switcher,connection-editor}.tsx, lib/{query-keys,target-context}.ts, app/e/[profileId]/, app/api/profiles/, fixtures/tests. No shared DB change.

## Tasks & steps
- [x] P2.1 SQLite app-owned store/migrations, one instance, durable volume, WAL-aware backup; encryption key separate. Wrong/missing key fails closed; restart retains state.
- [x] P2.2 Stable staging/production IDs seeded from server. Fingerprint config changes creates validated revision; override wins until reset; reset also revisioned. Never silently rebind on restart/credential rotation.
- [x] P2.3 Editor: name, DB host/port/database/user/TLS, optional API origin/credential, account scope. Secret replace/keep/clear explicit, list masked. Candidate test before activation. Custom starts read-only; disable/delete guard in-flight operations and keep history.
- [ ] P2.4 Outbound allowlisted host/origin, protocol/port/DNS/IP checks incl IPv6/rebinding/redirects. Connection tests authenticated, rate-limited, time-bounded and redacted. No arbitrary internal-network connector.
- [x] P2.5 App-local explicit pg query contracts pinned to inspected OMS schema snapshot; runtime capability probes replace duplicate generated Prisma output, with no shared client or target migrations (implementation decision in report). Parameterized diagnostic SQL; capability probes for schema/grants/version. Read-only custom DB needs no write grants. Activation rejects superuser/role-create/DB-create/DDL and unnecessary SELECT on auth/secret tables; dedicated restricted roles required. Negative fixtures prove ceiling.
- [ ] P2.6 Immutable profileId+revision context. Bounded pool cache, leases/refcounts, idle eviction/shutdown/drain. CAS edits and dispatch leases close race. Retired revisions allow recovery-only leases bound to already accepted operationId; reserve pool capacity and retain credentials until terminal + retention. Initial budget example: 5 connections/client, 4 active clients; measure deployment total. Never evict in-use client.
- [x] P2.7 URL per tab; query keys actor/profile/revision/account. Cancel reads; unsaved-changes handling; reset forms/modals/confirmation/rows; ignore stale responses. Accepted operations keep original target/history; pending/unknown write blocks rebind.
- [x] P2.8 Health/capabilities isolate failures; no API means commands unavailable, no fallback. Known production endpoint stays protected despite renaming/cloning. Runtime env changes follow revision protocol.

## Verification
App test:unit, test:integration, test:e2e. Two disposable Postgres DBs have same IDs/different values; third has missing optional column.
| Case | Expected |
|---|---|
| Two users/tabs interleaved stage/prod | Every row/audit has requested context |
| Slow old read after switch | Never renders in new view |
| Edit with old form/confirmation | 409, no new-target dispatch |
| Concurrent edits | One CAS wins, no secret leakage |
| Restart/reset/rotation | Correct overrides retained, pools drained |
| Custom no API/schema drift | Explicit read capabilities, no fallback |
| Exhaustion/outage/logout | Bounded pools, isolated errors, cache cleared |

## Risks / response
Single-instance durable disk prerequisite. Multi-replica/ephemeral host needs app storage revision before deploy. DNS aliases/copied marker alone cannot prove API binding.

## Additional verification
Exercise retired revision after timeout/restart: system reconciliation reacquires exact old client/API while interactive requests fail. Candidate profile editing cannot widen caller capabilities. Privilege probe never modifies grants automatically.

## Implementation checkpoint — 2026-11-14

Profiles/revisions/vault/editor/switching đã implement; fixtures kiểm chứng hai DB, scopes, pools, CAS và read leases. P2.4/P2.6 còn đầy đủ deployment DNS/rotation/restart-drain matrix; không coi local tests là chứng minh toàn bộ môi trường thật.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
