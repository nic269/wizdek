# Deployment, backup and recovery

## Provision in order

1. Back up the selected OMS DB and verify restore. Preserve a record containing `databaseFingerprint`, `createdAt`, `restoreVerified:true`, `backupReference`.
2. For API execution commands, apply the additive OMS migration `20261114020000_management_command_receipts` through the normal deployment procedure. It adds only `management_command`; old binaries remain compatible. Do not drop it on application rollback.
3. API connections do not require a manually provisioned DB/deployment ID. Direct-write backup/snapshot evidence still uses the database marker to distinguish restored/replaced databases; preserve that separate backup requirement.
4. For API execution commands, set each OMS deployment's `OMS_MANAGEMENT_SERVICE_TOKEN` to a strong, independent token (at least 32 characters). It is the only extra OMS bridge variable. In Wizdek, enter that environment's API URL and token alongside its DB connection. The server verifies their database fingerprints automatically. Missing or invalid token disables access. Token holders can run the bridge's fixed cron/Fraud command set; account-specific operations still validate the selected account in the OMS DB.
5. Use a PostgreSQL login with read access to the OMS tables and write grants for the settings actions you enable. A dedicated diagnostic role is optional; the application checks available features from actual read permissions and does not change database grants. The connection form uses Name, Database URL and Environment, with optional API URL and service token.
6. Configure the Wizdek operator, environment capabilities, database-wide scopes and encryption key. Host/API allowlists are optional when empty. No OMS account IDs are required to connect; account-specific tools offer names/emails after connection. Before enabling writes, configure `OMS_BACKUP_EVIDENCE_JSON` per profile with the exact endpoint fingerprint, database UUID, backup reference, restore-verification timestamp and expiry. Keep writes disabled initially. Optional target bindings may still classify known production databases, but are not required for API pairing.
7. Build and deploy the normal Wizdek `apps/app` artifact. Supply OMS runtime variables to that app, mount the persistent control-store volume and any required TLS CA bundle, and use one owning Node process. Stop the old standalone management instance before reusing its store/key.
8. Verify the native `/works/oms-management` route, shared shell and same-origin login callback. Test deep links, renewal and revoked sessions. No extra proxy/port is used.
9. Verify staging reads, enable staging writes deliberately, then exercise every feature and recovery case before production dark/read-only rollout.

The environment example is a template. Actual persistent storage, runtime secret values and target DB grants remain deployment inputs; local source migration did not provision them.

## Direct database and storage mode

Logs, settings, custom apps, store credentials, cron schedule/start/stop, original imports run in Wizdek. These paths neither require nor contact the OMS API; a configured API DNS outage must not block DB access. OMS retains job execution, immediate run requests and other business commands. The scheduler reads configuration from its DB, so changing a schedule does not run a job immediately.

Configure `OMS_DIRECT_RESOURCES_JSON` in the Wizdek server environment. Each key is `databaseFingerprint(connection)`; each value may contain `encryptionKey` and `storage`. The encryption key matches OMS's existing token-encryption key. Storage accepts `region`, `bucket`, required `prefix`, optional HTTPS `endpoint`, `forcePathStyle`, and optional `credentials` (`accessKeyId`, `secretAccessKey`, optional `sessionToken`). Omit credentials for the AWS SDK provider chain. Separate fingerprints and prefixes prevent choosing another environment's storage through UI input. Changing DB settings needs no new OMS schema; back up first as usual. Existing API receipts remain available for recovery of older commands. Existing encrypted profiles may retain old ID metadata; the new API does not require it, and editing a connection requires only URL/token. Do not delete pending operations during migration.


Direct reads/downloads and secret reveals are audited in the Wizdek control store, without writing to OMS during read-only requests. Direct settings writes use transactions, optimistic version checks and OMS audit receipts so timeout recovery can distinguish committed and cancelled operations. Keep both the control store and the OMS backup recoverable.

## Identity and trust

Management shares the public origin and session cookie with Wizdek, so they share an auth trust zone. Code/deployment separation is not compromise isolation. The native backend uses the generic Wizdek session helper directly; browser renewal remains same-origin. Never log Cookie, Set-Cookie, Authorization, connection strings, command bodies or raw file/secret responses.

OMS audit uses `actorId=null` plus immutable `externalActor.issuer/subject`; a Wizdek ID is never inserted into the OMS User foreign key.

## Backups

- Before profile/control-store maintenance, run `tsx scripts/backup-control.ts /secure/backup/control.sqlite` with `OMS_CONTROL_DB_PATH` set. The SQLite backup API includes committed WAL state. Do not copy the live database file alone.
- Back up the encryption key separately, plus deployment config/service credential references. Test decrypting a known revision in a disposable restore.
- Every prepared write requires unexpired operator evidence of a verified backup restore. Evidence binds both the endpoint fingerprint and database UUID; replacing a DB at the same address requires new evidence. The app validates this declaration; it does not run the backup provider or independently attest the restore exercise.
- Every prepared write stores an encrypted, checksummed before-snapshot and immutable payload before dispatch. This is a scoped recovery artifact, not a substitute for a full OMS backup before migration or broader data repair. Snapshots are bound to the original database UUID and profile revision.
- Use **Review restore** on a completed maintenance operation to prepare a new confirmed change on the same revision. Review the current value versus the saved value; execution uses compare-and-swap against the current version. An originally absent maintenance row is removed, restoring default behavior. Restoring other commands/provider effects is a separate domain-specific procedure.
- DB restore does not undo emails, provider actions or downstream job effects.

## Operations with uncertain results

An accepted operation keeps its profile ID, revision, actor, payload and target even when the browser changes environment. Local and target DB commits cannot be atomic together. After timeout, crash or local finalization failure:

1. Freeze further writes for that profile. The app blocks rebinding and additional writes while accepted/running/unknown operations exist.
2. Use **Check result**. Recovery uses retained credentials for the original revision.
3. Recovery acquires the same target lock as execution. A matching committed receipt completes local history. If no receipt exists, recovery durably records `not_executed` under that lock; a delayed original request then sees that cancellation and cannot execute. Local history becomes failed, permitting a newly reviewed operation.
4. If the target cannot be reached or its receipt does not match, the result stays unknown. Investigate the original operation ID, target audit/receipt and scheduler state; do not resubmit or delete the old revision/key.

Another currently authorized operator with the same profile/action capability can reconcile after the original operator leaves. The request and target receipt retain the original actor; the local audit records who reconciled it. Only the original actor may execute their prepared confirmation.

Do not rotate/revoke the only recovery credential while an operation remains uncertain.

## Single-instance lock

The control store owns a sibling `.owner` directory. Another instance fails readiness. Clean shutdown releases it; an abrupt host/process crash may leave it.

In development, new locks record the hostname and runtime. A new dev process automatically recovers a lock only when it belongs to development on the same host and its PID is confirmed absent (`ESRCH`). Recovery is serialized; live PIDs, permission errors, malformed/legacy metadata and other hosts fail closed. Use a local, unshared control-store path for development. Production never automatically reclaims a lock. If recovery itself is interrupted, its `.owner.recovery` directory also requires the manual procedure below.

To recover a stale lock: stop all instances, confirm no process/container can still write the volume, snapshot the database/WAL and lock metadata, then remove only the stale owner directory and start one instance. Never steal a live/ambiguous lock.

## Removal

Freeze writes → consistent snapshot + separate key backup → drain/reconcile every accepted/running/unknown operation → terminal ledger evidence → revoke bridge credentials and diagnostic grants → stop the management owner → remove `apps/app/app/works/oms-management`, the `/oms` alias, dedicated workflow and navigation wiring. Keep the generic identity endpoint; other Wizdek apps use it independently.

If any operation remains unknown, retain read-only recovery, the old encrypted revisions and key. Removing this app does not restore retired legacy tools automatically.

The removal rehearsal script copies source into a temporary directory, removes only management wiring there, supplies non-secret Wizdek build values and no OMS environment variables, then checks surviving auth/API and builds the main Wizdek app. It never edits the working checkout.
