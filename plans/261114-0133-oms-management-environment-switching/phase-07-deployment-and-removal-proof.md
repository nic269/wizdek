---
phase: 7
title: "Deploy, vận hành và removal proof"
status: in-progress
priority: P2
effort: "2d"
dependencies: [6]
---

# Phase 7: Deploy, vận hành và removal proof

## Goal
Separate deployment artifact, verified switching, removal without breaking Wizdek.

## Files
App Dockerfile, deploy/Caddyfile, deploy/compose.yml, .dockerignore, scripts/{verify-removal,backup-control,restore-control}.ts, docs/{deployment,operations,uninstall}.md, fixtures; .github/workflows/oms-management.yml and lockfile. Do not add OMS runtime to root hardcoded Dockerfile.

## Tasks & steps
- [x] P7.1 App image uses filtered/pruned deps, explicit pg contracts, no shared Prisma/DB generation dependency. App-local Turbo env; no OMS secrets needed for root build. Pin/test native SQLite driver and runtime packaging.
- [ ] P7.2 Enforce one replica/one Node process, Recreate/no rolling overlap, persistent exclusive volume, startup owner/migration lock; second instance refuses readiness. Plan executor owns app deploy/Caddyfile and deploy/compose.yml; discover/record host gateway owner/path, wire /oms and /oms/* before catch-all, preserve prefix, configure upstream service discovery/health and rollback. Proxy handles /oms assets/RSC/API. Readiness differentiates identity/control store from individual DB outages; no restart storm. Secrets absent from build args/layers/log/source maps.
- [ ] P7.3 Backup/restore control store and key recovery separately; restore encrypted profiles and pending-operation reconciliation. Document rotations/draining/disable/unknown outcomes.
- [ ] P7.4 Deploy bridge+management additively staging, prove read/write/commands/recovery with backups. Production dark/read-only deploy and health first. Only after full feature-matrix parity, shared-login/target-isolation proof, controlled write UAT and recovery checks pass, execute the user-approved phase-6 retirement/role scripts. Migrate existing assignments, revoke old sessions as needed, disable G_ADMIN grants/bypasses and retire privileged UI/API; verify old routes deny direct calls and normal OMS flows still work. Backup/rollback proof required. If a replacement gate fails, retain the legacy path temporarily and do not mark retirement complete.
- [x] P7.5 Removal rehearsal in disposable checkout, not dirty user workspace. Remove app/CI/proxy/optional launcher/declarative boundary policy, update lockfile importer, remove OMS env. Existing apps release checks use only Wizdek env/fixture DB. Generic identity may stay, knows no OMS.
- [ ] P7.6 Runtime proof: stop management, Wizdek login/stores/flows/database tools continue; target outage isolated; identity outage denies management cleanly. Normal OMS does not depend on tool uptime.
- [x] P7.7 Runbooks cover deploy/backups/profile edit/schema upgrades/cutover/uninstall. Freeze mutations, snapshot, drain/reconcile accepted/running/unknown, export terminal ledger, THEN revoke bridge credentials/grants and remove wiring. Unknown blocks final decommission; keep read/status recovery + encrypted revisions/key until resolved/handoff. Archive per retention decision, never delete business DBs.

## Mechanical verification
Proposed app scripts check:isolation, check-types, test:unit, test:integration, test:e2e, build, verify:removal all run with pnpm --filter @repo/oms-management. Existing pnpm release:check runs against recorded baseline and final state. Docker smoke uses disposable fixtures, no production writes.

## Acceptance evidence
Image/startup/shared-login e2e; target isolation/schema/pool tests; restore/unknown outcome recovery; feature/cutover matrix; removal diff + unaffected apps build/runtime. Reconcile all phase tasks, report implemented/validated/deployed separately.

## Risks / response
Ephemeral/multi-replica hosting requires app-owned storage redesign. Shared identity is intentional dependency. Removed management UI needs replacement tool if admin operations still required.

## Implementation checkpoint — 2026-11-14

Image build/runtime smoke và disposable removal rehearsal pass. Caddy/Compose/CI/runbooks có sẵn. P7.2/P7.3/P7.4/P7.6 còn gateway/host, control-store restore, actual deploy/parity/UAT/runtime independence. Không deploy hoặc retire legacy trong local implementation này.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
