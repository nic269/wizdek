---
phase: 4
title: "Settings thuần, backup và audit"
status: in-progress
priority: P2
effort: "3d"
dependencies: [3]
---

# Phase 4: Settings thuần, backup và audit

## Goal
Validated maintenance edits with concurrency protection, backup and audit.

## Files
App server/services/maintenance.ts, server/audit/{intents,reconcile,redaction}.ts, server/backups/{snapshots,restore-contract}.ts, server/operations/{confirmations,idempotency}.ts, mutation routes/editor/history/tests. No SQL or arbitrary settings console.

## Tasks & steps
- [x] P4.1 Explicit pure-setting schemas; maintenance path parsing/JSON matches source. Cron/Shopify/fraud/external actions use bridge.
- [x] P4.2 Durable encrypted pre-change backup before each setting write, target/revision/version metadata, absent-row state and restore script; verify readable before dispatch. Full DB backup before migrations/broad repair. Redacted audit is not backup.
- [x] P4.3 Durable intent plus expiring one-use production confirmation bound actor/revision/account/action/payload hash. No confirmation for read-only switching. Changes invalidate pending confirmation.
- [x] P4.4 Target transaction CAS + audit. AuditLog.actorId=null; metadata externalActor={issuer: wizdek, subject: immutable Wizdek user ID, displayNameSnapshot}, operationId/profile/revision and redacted diff. Do not insert external ID into OMS User FK. Audit failure rolls back.
- [x] P4.5 Transaction advisory lock on operationId + prior audit receipt/payload hash for idempotency. Same payload returns prior result; changed payload conflicts. Handle absent-row concurrent insert; specify receipt retention horizon.
- [x] P4.6 Reconcile app SQLite from target audit after response/local-finalize loss. Unknown blocks duplicates; local intent not commit proof. Recovery-only lease reacquires exact old revision; existing actor subject must match receipt.
- [x] P4.7 Restore exact target/revision with CAS current value and new backup/audit. Never overwrite newer unrelated changes silently.

## Verification
App integration/e2e: invalid-path parity, effect on existing OMS maintenance check, concurrent editors, duplicate POST, actor FK, confirmation switch/edit/expiry, crash at each intent/backup/commit/finalize boundary. Restore actual fixture; wrong target/later version rejected.

## Risks / response
DB grants only necessary reads, maintenance writes, audit insert; service key allowlist explicit. Cache/worker/encryption-dependent writes go via bridge. Retain old revision credentials for reconciliation until terminal.

Before enablement validate explicit DB grants/privilege ceiling, not only app guards. A shared-login session alone cannot grant production writes or profile edit.

## Implementation checkpoint — 2026-11-14

Maintenance validation, durable snapshot/confirmation, atomic CAS+audit, recovery tombstone và prior-value/absent-row restore đã implement. 13 PostgreSQL integration cases gồm write/restore/stale conflict. Full host backup restore và exhaustive process-crash injection vẫn thuộc deployment gates.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
