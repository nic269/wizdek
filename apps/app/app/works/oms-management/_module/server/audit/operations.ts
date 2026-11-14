import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Actor, TargetRef } from "../../lib/contracts";
import type { Config } from "../config";
import { invariant, ManagementError } from "../errors";
import { capabilitiesFor, requireCapability } from "../identity/access-policy";
import { bridgeRequest, fingerprint, verifyBinding } from "../oms-api/client";
import type { Connection } from "../profiles/schema";
import { redact } from "../redact";
import { maintenance } from "../services/diagnostics";
import {
  directVersion,
  executeDirectSettings,
  isDirectSettingsAction,
  previewDirectSettings,
} from "../services/direct-settings";
import { parseMaintenance } from "../services/maintenance-validation";
import { clients } from "../target/clients";
import { probe } from "../target/compatibility";
import { profiles, readTarget } from "../target/context";
import {
  persistSnapshot,
  readSnapshot,
  requireBackupEvidence,
} from "./backups";
export const operationSchema = z
  .object({
    accountId: z.string().min(1).max(128).optional(),
    action: z.enum([
      "maintenance.update",
      "cron.run-now",
      "cron.start",
      "cron.stop",
      "cron.update",
      "shopify.settings.update",
      "shopify.app.create",
      "shopify.app.update",
      "shopify.app.delete",
      "shopify.signature.update",
      "fraud.review",
    ]),
    expectedVersion: z.string().max(128).nullable(),
    payload: z.record(z.string(), z.unknown()),
    profileId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    revision: z.number().int().positive(),
  })
  .strict();
type OperationInput = z.infer<typeof operationSchema>;
interface StoredRequest {
  actor: Actor;
  before: unknown;
  databaseIdentity?: string;
  execution?: "direct" | "bridge";
  input: OperationInput;
  restoreAbsent?: boolean;
}
interface Operation {
  action: string;
  actor_id: string;
  confirmation_hash: string | null;
  created_at: string;
  expires_at: string;
  id: string;
  payload_hash: string;
  profile_id: string;
  request_cipher: string;
  result_cipher: string | null;
  revision: number;
  state: string;
  updated_at: string;
}
const capability = (action: string) =>
  isDirectSettingsAction(action)
    ? ("settings:write" as const)
    : ("commands" as const);
function usesDirect(action: string, stored: StoredRequest) {
  return action === "maintenance.update" || stored.execution === "direct";
}
function storedCapability(action: string, stored: StoredRequest) {
  return action === "maintenance.update" || stored.execution === "direct"
    ? ("settings:write" as const)
    : ("commands" as const);
}
function assertDatabaseIdentity(
  actual: string | null,
  expected: string | undefined
) {
  invariant(
    expected && actual === expected,
    "database_identity_mismatch",
    "The connected database no longer matches this operation and backup.",
    409
  );
}
function savedIdentity(
  stored: StoredRequest,
  connection: Connection,
  config: Config,
  profileId: string
) {
  return (
    stored.databaseIdentity ??
    connection.api?.databaseIdentity ??
    config.backupEvidence[profileId]?.databaseIdentity
  );
}
function directReceipt(action: string, id: string) {
  if (action === "maintenance.update") {
    return {
      cancelledAction: "management.maintenance.not_executed",
      lock: "management-maintenance",
      receiptAction: "management.maintenance.update",
    };
  }
  return {
    cancelledAction: "management.direct.not_executed",
    lock: `management-direct:${id}`,
    receiptAction: `management.direct.${action}`,
  };
}
function requiresGlobal(input: OperationInput) {
  return (
    isDirectSettingsAction(input.action) &&
    input.action !== "shopify.signature.update"
  );
}
function writesEnabled() {
  invariant(
    process.env.OMS_WRITES_ENABLED === "true",
    "writes_disabled",
    "Writes are disabled for this deployment.",
    403
  );
}
export async function prepare(
  actor: Actor,
  input: OperationInput,
  config: Config,
  restoreAbsent = false
) {
  writesEnabled();
  const repository = profiles(config);
  const ref = { profileId: input.profileId, revision: input.revision };
  const resolved = repository.resolve(actor, ref, capability(input.action));
  requireBackupEvidence(ref.profileId, resolved.connection, config);
  if (requiresGlobal(input)) {
    invariant(
      resolved.connection.globalDiagnostics,
      "global_scope_required",
      "Database-wide settings require global access.",
      403
    );
  }
  if (input.accountId) {
    invariant(
      resolved.connection.globalDiagnostics ||
        resolved.connection.accountIds.includes(input.accountId),
      "account_denied",
      "The account is not in this connection scope.",
      403
    );
  } else {
    invariant(
      resolved.connection.globalDiagnostics,
      "global_scope_required",
      "This action requires explicit global scope.",
      403
    );
  }
  invariant(
    !repository.hasPending(ref.profileId),
    "operations_pending",
    "Resolve pending operations before preparing another write.",
    409
  );
  let preparedInput = input;
  if (preparedInput.action === "maintenance.update") {
    preparedInput = {
      ...preparedInput,
      payload: parseMaintenance(preparedInput.payload),
    };
  }
  const lease = await clients(config).lease(
    `${ref.profileId}:${ref.revision}`,
    resolved.connection,
    config
  );
  let before: unknown;
  const execution = isDirectSettingsAction(preparedInput.action)
    ? "direct"
    : "bridge";
  let databaseIdentity: string | undefined;
  try {
    await lease.client.query("BEGIN READ ONLY");
    const compatibility = await probe(lease.client);
    assertDatabaseIdentity(
      compatibility.databaseIdentity,
      config.backupEvidence[ref.profileId]?.databaseIdentity
    );
    databaseIdentity = compatibility.databaseIdentity ?? undefined;
    if (execution === "bridge") {
      await verifyBinding(
        resolved.connection,
        config,
        compatibility.databaseIdentity
      );
    }
    if (preparedInput.action === "maintenance.update") {
      invariant(
        compatibility.features.includes("maintenance"),
        "feature_unavailable",
        "Maintenance settings are not available.",
        409
      );
      before = await maintenance(lease.client, resolved.connection);
    } else if (execution === "direct") {
      before = await previewDirectSettings(lease.client, preparedInput);
      const currentVersion = directVersion(preparedInput.action, before);
      invariant(
        preparedInput.expectedVersion === currentVersion,
        "version_conflict",
        "The record changed. Reload before preparing this operation.",
        409
      );
    } else if (preparedInput.action.startsWith("cron.")) {
      const row = await lease.client.query(
        'SELECT "jobKey",enabled,"cronExpression","updatedAt" FROM scheduled_job_config WHERE "jobKey"=$1',
        [String(preparedInput.payload.jobKey)]
      );
      before = row.rows[0] ?? null;
    } else {
      const preview = (await bridgeRequest(
        resolved.connection,
        config,
        "preview",
        {
          accountId: preparedInput.accountId,
          action: preparedInput.action,
          actor: {
            displayNameSnapshot: actor.name,
            issuer: "wizdek",
            subject: actor.id,
          },
          expectedVersion: preparedInput.expectedVersion,
          operationId: randomUUID(),
          payload: preparedInput.payload,
          profileId: preparedInput.profileId,
          revision: preparedInput.revision,
        }
      )) as { before: unknown };
      ({ before } = preview);
      const currentVersion =
        preparedInput.action === "shopify.settings.update"
          ? fingerprint(before)
          : ((before as { updatedAt?: string } | null)?.updatedAt ?? null);
      invariant(
        preparedInput.expectedVersion === null ||
          preparedInput.expectedVersion === currentVersion,
        "version_conflict",
        "The record changed. Reload before preparing this operation.",
        409
      );
      preparedInput = { ...preparedInput, expectedVersion: currentVersion };
    }
  } finally {
    await lease.client.query("ROLLBACK").catch(() => undefined);
    lease.release();
  }
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 5 * 60_000).toISOString();
  repository.store.transaction(() => {
    repository.resolve(actor, ref, capability(preparedInput.action));
    invariant(
      !repository.hasPending(ref.profileId),
      "operations_pending",
      "Resolve pending operations first.",
      409
    );
    repository.store.db
      .prepare("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        actor.id,
        ref.profileId,
        ref.revision,
        preparedInput.action,
        fingerprint(
          restoreAbsent
            ? { ...preparedInput, restoreAbsent: true }
            : preparedInput
        ),
        "prepared",
        repository.store.vault.seal(
          {
            actor,
            before,
            databaseIdentity,
            execution,
            input: preparedInput,
            restoreAbsent,
          },
          `operation:${id}`
        ),
        null,
        fingerprint(token),
        expires,
        now,
        now
      );
    repository.store.audit(
      actor.id,
      ref.profileId,
      ref.revision,
      "operation.prepared",
      { action: preparedInput.action, operationId: id }
    );
    persistSnapshot(
      repository.store,
      id,
      ref.profileId,
      resolved.connection,
      config,
      { before, input: preparedInput, restoreAbsent }
    );
  });
  return {
    action: preparedInput.action,
    after: restoreAbsent ? { absent: true } : redact(preparedInput.payload),
    before: redact(before),
    confirmation: token,
    expiresAt: expires,
    operationId: id,
    target: {
      ...ref,
      name: resolved.row.name,
      safetyClass: resolved.row.safety_class,
    },
  };
}
function getOperation(
  id: string,
  actor: Actor,
  config: Config,
  recovery = false
) {
  const repository = profiles(config);
  const operation = repository.store.db
    .prepare("SELECT * FROM operations WHERE id=?")
    .get(id) as unknown as Operation | undefined;
  invariant(operation, "operation_not_found", "Operation was not found.", 404);
  invariant(
    recovery || operation.actor_id === actor.id,
    "operation_not_found",
    "Operation was not found.",
    404
  );
  const row = repository.row(operation.profile_id);
  invariant(row, "profile_not_found", "Connection was not found.", 404);
  const stored = repository.store.vault.open<StoredRequest>(
    operation.request_cipher,
    `operation:${id}`
  );
  requireCapability(
    actor,
    { id: row.id, safetyClass: row.safety_class },
    storedCapability(operation.action, stored),
    config
  );
  return { operation, repository, row, stored };
}
function envelope(operation: Operation, stored: StoredRequest) {
  return {
    accountId: stored.input.accountId,
    action: operation.action,
    actor: {
      displayNameSnapshot: stored.actor.name,
      issuer: "wizdek",
      subject: stored.actor.id,
    },
    expectedVersion: stored.input.expectedVersion,
    operationId: operation.id,
    payload: stored.input.payload,
    profileId: operation.profile_id,
    revision: operation.revision,
  };
}
function executionFailure(
  error: unknown,
  outcomeMayBeUnknown: boolean,
  rollbackSucceeded: boolean
) {
  const definitive =
    error instanceof ManagementError &&
    error.code === "bridge_rejected_definitive";
  if (!definitive && (outcomeMayBeUnknown || !rollbackSucceeded)) {
    return {
      error: new ManagementError(
        "operation_unknown",
        "The result is unknown. Reconcile this operation before submitting another write.",
        502
      ),
      state: "unknown",
    } as const;
  }
  return {
    error: new ManagementError(
      "operation_rejected",
      error instanceof ManagementError
        ? error.message
        : "The operation was rejected before it was committed.",
      409
    ),
    state: "failed",
  } as const;
}
export async function execute(
  actor: Actor,
  id: string,
  confirmation: string,
  acknowledgement: string,
  config: Config
) {
  writesEnabled();
  const { repository, operation, stored, row } = getOperation(
    id,
    actor,
    config
  );
  const ref = { profileId: operation.profile_id, revision: operation.revision };
  const resolved = repository.resolve(
    actor,
    ref,
    storedCapability(operation.action, stored)
  );
  requireBackupEvidence(ref.profileId, resolved.connection, config);
  readSnapshot(
    repository.store,
    id,
    resolved.connection,
    stored.databaseIdentity
  );
  const received = Buffer.from(fingerprint(confirmation));
  const expected = Buffer.from(operation.confirmation_hash ?? "");
  invariant(
    operation.state === "prepared" &&
      operation.expires_at > new Date().toISOString() &&
      received.length === expected.length &&
      timingSafeEqual(received, expected),
    "confirmation_expired",
    "This confirmation is invalid or expired. Prepare a new operation.",
    409
  );
  invariant(
    row.safety_class !== "production" || acknowledgement === "production",
    "production_confirmation_required",
    "Type production to confirm this operation."
  );
  repository.store.transaction(() => {
    repository.resolve(actor, ref, storedCapability(operation.action, stored));
    invariant(
      !repository.hasPending(ref.profileId),
      "operations_pending",
      "Resolve pending operations first.",
      409
    );
    const changed = repository.store.db
      .prepare(
        "UPDATE operations SET state='accepted',confirmation_hash=NULL,updated_at=? WHERE id=? AND state='prepared'"
      )
      .run(new Date().toISOString(), id);
    invariant(
      changed.changes === 1,
      "operation_conflict",
      "Operation was already accepted.",
      409
    );
  });
  const lease = await clients(config)
    .lease(
      `${ref.profileId}:${ref.revision}`,
      resolved.connection,
      config,
      true
    )
    .catch((error) => {
      repository.store.db
        .prepare("UPDATE operations SET state='failed',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), id);
      throw error;
    });
  let outcomeMayBeUnknown = false;
  try {
    const compatibility = await probe(lease.client);
    assertDatabaseIdentity(
      compatibility.databaseIdentity,
      savedIdentity(stored, resolved.connection, config, ref.profileId)
    );
    if (!usesDirect(operation.action, stored)) {
      await verifyBinding(
        resolved.connection,
        config,
        compatibility.databaseIdentity
      );
    }
    repository.store.db
      .prepare("UPDATE operations SET state='running',updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    let result: unknown;
    if (operation.action === "maintenance.update") {
      await lease.client.query("BEGIN");
      await lease.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["management-maintenance"]
      );
      const prior = await lease.client.query(
        "SELECT id FROM audit_log WHERE id=$1",
        [id]
      );
      invariant(
        prior.rows.length === 0,
        "operation_cancelled",
        "This operation was already finalized by recovery.",
        409
      );
      const current = await maintenance(lease.client, resolved.connection);
      const version = current.version
        ? new Date(current.version).toISOString()
        : null;
      invariant(
        version === stored.input.expectedVersion,
        "version_conflict",
        "Maintenance settings changed after this form was loaded.",
        409
      );
      const value = JSON.stringify(parseMaintenance(stored.input.payload));
      // The predicate also protects against the legacy settings writer, which
      // does not participate in the management advisory lock.
      let changed: { rowCount: number | null };
      if (stored.restoreAbsent) {
        invariant(
          version !== null,
          "restore_no_change",
          "Maintenance configuration is already absent. Reload the current state.",
          409
        );
        changed = await lease.client.query(
          "DELETE FROM site_setting WHERE key=$1 AND \"updatedAt\"=($2::timestamptz AT TIME ZONE 'UTC')",
          ["maintenanceMode", version]
        );
      } else if (version === null) {
        changed = await lease.client.query(
          "INSERT INTO site_setting(key,value,\"createdAt\",\"updatedAt\") VALUES($1,$2,NOW() AT TIME ZONE 'UTC',date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC')) ON CONFLICT(key) DO NOTHING",
          ["maintenanceMode", value]
        );
      } else {
        changed = await lease.client.query(
          "UPDATE site_setting SET value=$2,\"updatedAt\"=GREATEST(date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC'),\"updatedAt\"+interval '1 millisecond') WHERE key=$1 AND \"updatedAt\"=($3::timestamptz AT TIME ZONE 'UTC')",
          ["maintenanceMode", value, version]
        );
      }
      invariant(
        changed.rowCount === 1,
        "version_conflict",
        "Maintenance settings changed before the write could be committed.",
        409
      );
      const metadata = {
        after: stored.restoreAbsent ? { absent: true } : stored.input.payload,
        before: current.value,
        externalActor: {
          displayNameSnapshot: actor.name,
          issuer: "wizdek",
          subject: actor.id,
        },
        operationId: id,
        payloadHash: operation.payload_hash,
        profileId: ref.profileId,
        revision: ref.revision,
      };
      await lease.client.query(
        'INSERT INTO audit_log(id,"actorId",action,"targetType","targetId",metadata,"createdAt") VALUES($1,NULL,$2,$3,$4,$5::jsonb,NOW())',
        [
          id,
          "management.maintenance.update",
          "ManagementCommand",
          id,
          JSON.stringify(metadata),
        ]
      );
      outcomeMayBeUnknown = true;
      await lease.client.query("COMMIT");
      result = { operationId: id, status: "completed" };
    } else if (stored.execution === "direct") {
      await lease.client.query("BEGIN");
      await lease.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`management-direct:${id}`]
      );
      const receipt = await lease.client.query(
        "SELECT id FROM audit_log WHERE id=$1",
        [id]
      );
      invariant(
        !receipt.rows.length,
        "operation_cancelled",
        "This operation was already finalized by recovery.",
        409
      );
      result = await executeDirectSettings(
        lease.client,
        resolved.connection,
        stored.input
      );
      await lease.client.query(
        `INSERT INTO audit_log(id,"actorId",action,"targetType","targetId",metadata,"createdAt") VALUES($1,NULL,$2,$3,$4,$5::jsonb,NOW() AT TIME ZONE 'UTC')`,
        [
          id,
          `management.direct.${operation.action}`,
          "ManagementCommand",
          id,
          JSON.stringify({
            externalActor: {
              displayNameSnapshot: actor.name,
              issuer: "wizdek",
              subject: actor.id,
            },
            operationId: id,
            payloadHash: operation.payload_hash,
            profileId: ref.profileId,
            result: redact(result),
            revision: ref.revision,
          }),
        ]
      );
      outcomeMayBeUnknown = true;
      await lease.client.query("COMMIT");
    } else {
      outcomeMayBeUnknown = true;
      result = await bridgeRequest(
        resolved.connection,
        config,
        "commands",
        envelope(operation, stored)
      );
      invariant(
        (result as { status?: string }).status !== "not_executed",
        "bridge_rejected_definitive",
        "This operation was cancelled before execution.",
        409
      );
    }
    repository.store.db
      .prepare(
        "UPDATE operations SET state='completed',result_cipher=?,updated_at=? WHERE id=?"
      )
      .run(
        repository.store.vault.seal(redact(result), `result:${id}`),
        new Date().toISOString(),
        id
      );
    repository.store.audit(
      actor.id,
      ref.profileId,
      ref.revision,
      "operation.completed",
      { operationId: id }
    );
    return { operationId: id, result: redact(result), status: "completed" };
  } catch (error) {
    let rollbackSucceeded = true;
    try {
      await lease.client.query("ROLLBACK");
    } catch {
      rollbackSucceeded = false;
    }
    const failure = executionFailure(
      error,
      outcomeMayBeUnknown,
      rollbackSucceeded
    );
    repository.store.db
      .prepare("UPDATE operations SET state=?,updated_at=? WHERE id=?")
      .run(failure.state, new Date().toISOString(), id);
    throw failure.error;
  } finally {
    lease.release();
  }
}
export async function reconcile(actor: Actor, id: string, config: Config) {
  const { repository, operation, stored } = getOperation(
    id,
    actor,
    config,
    true
  );
  if (!["accepted", "running", "unknown"].includes(operation.state)) {
    return { operationId: id, status: operation.state };
  }
  // Recovery intentionally resolves the persisted revision, even after a future retirement.
  const ref = { profileId: operation.profile_id, revision: operation.revision };
  const revision = repository.revision(ref);
  const lease = await clients(config).lease(
    `${ref.profileId}:${ref.revision}`,
    revision.connection,
    config,
    true
  );
  try {
    let completed = false;
    let notExecuted = false;
    let result: unknown;
    if (usesDirect(operation.action, stored)) {
      const compatibility = await probe(lease.client);
      assertDatabaseIdentity(
        compatibility.databaseIdentity,
        savedIdentity(stored, revision.connection, config, ref.profileId)
      );
      const { receiptAction, cancelledAction, lock } = directReceipt(
        operation.action,
        id
      );
      await lease.client.query("BEGIN");
      await lease.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [lock]
      );
      const receipt = await lease.client.query(
        "SELECT action,metadata FROM audit_log WHERE id=$1",
        [id]
      );
      const metadata = receipt.rows[0]?.metadata;
      if (receipt.rows[0]) {
        invariant(
          metadata?.externalActor?.subject === stored.actor.id &&
            metadata?.payloadHash === operation.payload_hash,
          "receipt_mismatch",
          "The target receipt does not match this operation.",
          409
        );
        completed = receipt.rows[0].action === receiptAction;
        notExecuted = receipt.rows[0].action === cancelledAction;
      } else {
        await lease.client.query(
          'INSERT INTO audit_log(id,"actorId",action,"targetType","targetId",metadata,"createdAt") VALUES($1,NULL,$2,$3,$4,$5::jsonb,NOW())',
          [
            id,
            cancelledAction,
            "ManagementCommand",
            id,
            JSON.stringify({
              externalActor: { issuer: "wizdek", subject: stored.actor.id },
              payloadHash: operation.payload_hash,
              reconciledBy: actor.id,
            }),
          ]
        );
        notExecuted = true;
      }
      await lease.client.query("COMMIT");
      result = { status: completed ? "completed" : "not_executed" };
    } else {
      const compatibility = await probe(lease.client);
      assertDatabaseIdentity(
        compatibility.databaseIdentity,
        savedIdentity(stored, revision.connection, config, ref.profileId)
      );
      await verifyBinding(
        revision.connection,
        config,
        compatibility.databaseIdentity
      );
      result = await bridgeRequest(
        revision.connection,
        config,
        "status",
        envelope(operation, stored)
      );
      completed = (result as { status?: string }).status === "completed";
      notExecuted = (result as { status?: string }).status === "not_executed";
    }
    if (completed || notExecuted) {
      repository.store.db
        .prepare(
          "UPDATE operations SET state=?,result_cipher=?,updated_at=? WHERE id=?"
        )
        .run(
          completed ? "completed" : "failed",
          repository.store.vault.seal(redact(result), `result:${id}`),
          new Date().toISOString(),
          id
        );
      repository.store.audit(
        actor.id,
        ref.profileId,
        ref.revision,
        "operation.reconciled",
        {
          operationId: id,
          originalActor: stored.actor.id,
          outcome: completed ? "completed" : "not_executed",
        }
      );
    }
    let status = "unknown";
    if (completed) {
      status = "completed";
    } else if (notExecuted) {
      status = "failed";
    }
    return {
      operationId: id,
      result: redact(result),
      status,
    };
  } finally {
    await lease.client.query("ROLLBACK").catch(() => undefined);
    lease.release();
  }
}
export function history(actor: Actor, ref: TargetRef, config: Config) {
  const repository = profiles(config);
  const { row } = repository.resolve(actor, ref);
  const grants = capabilitiesFor(
    actor,
    { id: row.id, safetyClass: row.safety_class },
    config
  );
  if (grants.includes("commands") || grants.includes("settings:write")) {
    return repository.store.db
      .prepare(
        "SELECT id,actor_id,profile_id,revision,action,state,created_at,updated_at FROM operations WHERE profile_id=? ORDER BY created_at DESC LIMIT 100"
      )
      .all(ref.profileId);
  }
  return repository.store.db
    .prepare(
      "SELECT id,profile_id,revision,action,state,created_at,updated_at FROM operations WHERE actor_id=? AND profile_id=? ORDER BY created_at DESC LIMIT 100"
    )
    .all(actor.id, ref.profileId);
}
export async function prepareRestore(actor: Actor, id: string, config: Config) {
  const { repository, operation } = getOperation(id, actor, config, true);
  invariant(
    operation.action === "maintenance.update" &&
      operation.state === "completed",
    "restore_unavailable",
    "Automatic restore is available for completed maintenance changes only.",
    409
  );
  const ref = { profileId: operation.profile_id, revision: operation.revision };
  repository.resolve(actor, ref, "settings:write");
  const { snapshot, current } = await readTarget(
    actor,
    ref,
    config,
    "maintenance",
    async (db, connection) => {
      const compatibility = await probe(db);
      invariant(
        compatibility.databaseIdentity,
        "database_identity_mismatch",
        "The connected database identity is unavailable.",
        409
      );
      const savedSnapshot = readSnapshot<{
        before: { value: unknown; version: string | null };
      }>(repository.store, id, connection, compatibility.databaseIdentity);
      return {
        current: await maintenance(db, connection),
        snapshot: savedSnapshot,
      };
    }
  );
  invariant(
    snapshot.before.version !== null || current.version !== null,
    "restore_no_change",
    "Maintenance configuration is already absent. There is nothing to restore.",
    409
  );
  const preview = await prepare(
    actor,
    {
      ...ref,
      action: "maintenance.update",
      expectedVersion: current.version
        ? new Date(current.version).toISOString()
        : null,
      payload: parseMaintenance(snapshot.before.value),
    },
    config,
    snapshot.before.version === null
  );
  repository.store.audit(
    actor.id,
    ref.profileId,
    ref.revision,
    "backup.restore.prepared",
    { operationId: preview.operationId, originalOperationId: id }
  );
  return preview;
}
