import type { Config } from "../config";
import { invariant } from "../errors";
import { databaseFingerprint, fingerprint } from "../oms-api/client";
import type { Connection } from "../profiles/schema";
import type { ControlStore } from "../storage/control-store";
export function requireBackupEvidence(
  profileId: string,
  connection: Connection,
  config: Config
) {
  const evidence = config.backupEvidence[profileId];
  const now = Date.now();
  const anchor = config.targetBindings.find(
    (item) =>
      item.host === connection.database.host &&
      item.port === connection.database.port &&
      item.database === connection.database.name
  );
  invariant(
    evidence &&
      evidence.databaseFingerprint === databaseFingerprint(connection) &&
      (!connection.api?.databaseIdentity ||
        evidence.databaseIdentity === connection.api.databaseIdentity) &&
      (!anchor || evidence.databaseIdentity === anchor.databaseIdentity) &&
      Date.parse(evidence.restoreVerifiedAt) <= now &&
      Date.parse(evidence.expiresAt) > now,
    "backup_required",
    "A matching, unexpired backup with verified restore evidence must be configured before writing.",
    409
  );
  return evidence;
}
export function persistSnapshot(
  store: ControlStore,
  id: string,
  profileId: string,
  connection: Connection,
  config: Config,
  snapshot: unknown
) {
  const evidence = requireBackupEvidence(profileId, connection, config);
  const normalized = JSON.parse(
    JSON.stringify({
      databaseIdentity: evidence.databaseIdentity,
      snapshot,
    })
  );
  const checksum = fingerprint(normalized);
  const ciphertext = store.vault.seal(normalized, `backup:${id}`);
  invariant(
    fingerprint(store.vault.open(ciphertext, `backup:${id}`)) === checksum,
    "backup_invalid",
    "The encrypted before-snapshot could not be verified.",
    503
  );
  const now = new Date().toISOString();
  store.db
    .prepare("INSERT INTO backup_evidence VALUES(?,?,?,?,?,?,?)")
    .run(
      id,
      databaseFingerprint(connection),
      evidence.backupReference,
      checksum,
      ciphertext,
      now,
      evidence.restoreVerifiedAt
    );
}
export function readSnapshot<T>(
  store: ControlStore,
  id: string,
  connection: Connection,
  expectedDatabaseIdentity?: string | null
): T {
  const row = store.db
    .prepare("SELECT * FROM backup_evidence WHERE operation_id=?")
    .get(id) as
    | { target_fingerprint: string; checksum: string; ciphertext: string }
    | undefined;
  invariant(
    row && row.target_fingerprint === databaseFingerprint(connection),
    "backup_missing",
    "The operation has no matching before-snapshot.",
    409
  );
  const snapshot = store.vault.open<{ databaseIdentity: string; snapshot: T }>(
    row.ciphertext,
    `backup:${id}`
  );
  invariant(
    fingerprint(snapshot) === row.checksum,
    "backup_invalid",
    "The before-snapshot checksum does not match.",
    409
  );
  invariant(
    snapshot.databaseIdentity ===
      (expectedDatabaseIdentity ?? connection.api?.databaseIdentity),
    "backup_target_changed",
    "The snapshot belongs to a different database identity.",
    409
  );
  return snapshot.snapshot;
}
