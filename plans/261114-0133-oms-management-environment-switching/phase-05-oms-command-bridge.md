---
phase: 5
title: "OMS command bridge và privileged tools"
status: in-progress
priority: P2
effort: "4d"
dependencies: [4]
---

# Phase 5: OMS command bridge và privileged tools

## Goal
Management calls privileged commands through internal OMS bridge, reusing existing business execution.

## Ownership / files
WIZDEK app server/oms-api/{client,contracts,binding}.ts, cron/Shopify/DHL/fraud/download screens/services/tests.
OMS new apps/api/src/routes/management.ts, middleware/management-auth.ts, lib/management/{commands,receipts}.ts; register in server.ts. Extract narrow services from current site-config/Shopify/DHL/debug/fulfillment handlers as needed, keep normal route guards until cutover.
Additive OMS ManagementCommand receipt table/migration mandatory for cron operation correlation (source runner has no such key); backup first. OMS-owned scripts/provision-management-identity.ts creates existing SiteSetting marker after backup. API env.example/root env example if present, deployment/docker-compose.ec2.yml, scripts/deploy/deploy-ec2.sh and release runbook get nonsecret bridge config/provisioning instructions. No management profiles/auth/UI in OMS.

## Tasks & steps
- [x] P5.1 Freeze v1 URLs/schemas/tests for identity/capabilities, cron catalog/schedule/start/stop/run, status, Shopify app/signature/reveal, DHL/import downloads, fraud review. No wildcard proxy/SQL.
- [x] P5.2 Environment-specific scoped/revocable service credentials; authenticate before trusting external actor; independent deployment/audience check. Wizdek cookie alone cannot call bridge; no G_ADMIN service user.
- [x] P5.3 Provision SiteSetting management.databaseIdentity random UUID; API independently configured OMS_MANAGEMENT_EXPECTED_DB_ID and OMS_MANAGEMENT_DEPLOYMENT_ID. Verify marker + API normalized actual datasource endpoint/port/database fingerprint; no auto aliases. Clone workflow rotates marker/env before write enable. Connection tests remain read-only. Missing/mismatch fails closed; stage DB + prod API and copied marker tests required.
- [x] P5.4 Durable receipt accepted/running/succeeded/failed/unknown, unique deployment/account/operationId + payload hash. Cron receipt claim, config/run insert and audit MUST share transaction. Refactor queueManualScheduledJobRun to accept transaction + receipt linkage; wake only after commit. Replay returns original run, changed payload 409. Remote ambiguous effect stays unknown, never auto-reexecuted.
- [x] P5.5 Cron preserves validators/queue/wake, original run receipt and target. No scheduler in management.
- [ ] P5.6 Shopify app/default/signature/reveal parity. Encryption keys stay OMS. Explicit audited POST reveal, never raw secrets in list/persistent query cache/log; clear on switch/logout/close.
- [ ] P5.7 Stream DHL/import artifacts with DB-text/CSV fallback. Strengthen scoped admin row lookup, remote host/redirect validation, resource caps. Do not forward auth/service credentials to storage hosts.
- [x] P5.8 Minimal fraud review screen + command preserving eligibility/state/account/audit. Normal fulfillment stays OMS. Backup cannot reverse external effects.
- [x] P5.9 Capability unavailable states for DB-only/older bridge; complete feature matrix without silently dropping controls. Backup/receipt/audit consistently labelled.

## Verification
App integration/e2e; OMS focused bridge/service tests and API type/build scripts. Two fake APIs + disposable DBs. Wrong credential/action/account/audience/revision causes no effect. Duplicate queues once; altered payload rejects; timeout reconciles original run. Unknown remote outcome never blindly retries. Copied marker/mismatched pair rejects; cron wakes worker; secrets remain OMS; downloads audited; invalid fraud transition rejected.

## Risks / response
Cross-repo bridge approved by user. Deploy additively before UI enable. Service needing OMS User FK must accept namespaced external actor + optional OMS actor, not fabricate privileged user. Track every touched service and regression coverage.

## Deploy/env contract
Separate staging/prod secret provisioning for OMS_MANAGEMENT_SERVICE_TOKEN, OMS_MANAGEMENT_DEPLOYMENT_ID, OMS_MANAGEMENT_EXPECTED_DB_ID and allowed action/account scopes. Tokens only secret store/runtime env, no real values in examples. Disabled bridge is inert when config absent; enabling with missing/mismatched config fails readiness. Update actual env consumers/compose/runbook and test rotation/revocation.
Release A additive schema compatible old binary; B bridge code and capability gate. Existing deploy migrates before replacing old container, so test old image on expanded schema and rollback image. No drop/rename/enum removal this release.

## Implementation checkpoint — 2026-11-14

Bridge v1 và các controls đã implement, 16 bridge tests + 69 affected OMS regression pass. P5.6/P5.7 chưa check vì còn live Shopify/provider parity và artifact fixtures; downloads hiện buffer tối đa 50MB, không claim end-to-end streaming.

Checked tasks reflect implemented local scope; remaining live/expanded verification is not implied. See [implementation evidence](./implementation-report.md).
