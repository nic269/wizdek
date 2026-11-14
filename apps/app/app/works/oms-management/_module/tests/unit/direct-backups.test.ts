import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSnapshot,
  requireBackupEvidence,
} from "../../server/audit/backups";
import { getConfig } from "../../server/config";
import { databaseFingerprint, fingerprint } from "../../server/oms-api/client";
import type { Connection } from "../../server/profiles/schema";

import type { ControlStore } from "../../server/storage/control-store";

const connection: Connection = {
  accountIds: [],
  api: null,
  database: {
    host: "db.example.test",
    name: "staging",
    password: "",
    port: 5432,
    tls: true,
    user: "reader",
  },
  globalDiagnostics: true,
};
const identity = "2c878880-ec61-43d9-a857-1ee32038a3fd";
afterEach(() => vi.unstubAllEnvs());
describe("direct database backup evidence", () => {
  it("does not restore snapshots into a replacement DB at the same coordinates", () => {
    const snapshot = {
      databaseIdentity: identity,
      snapshot: { before: "old-database" },
    };
    const store = {
      db: {
        prepare: () => ({
          get: () => ({
            checksum: fingerprint(snapshot),
            ciphertext: "fixture",
            target_fingerprint: databaseFingerprint(connection),
          }),
        }),
      },
      vault: { open: () => snapshot },
    } as unknown as ControlStore;
    expect(readSnapshot(store, "operation", connection, identity)).toEqual({
      before: "old-database",
    });
    expect(() =>
      readSnapshot(
        store,
        "operation",
        connection,
        "66c76f6e-79ec-43ae-8f9f-a5a08dfd056d"
      )
    ).toThrow();
    expect(() => readSnapshot(store, "operation", connection)).toThrow();
  });
  function config() {
    vi.stubEnv(
      "OMS_BACKUP_EVIDENCE_JSON",
      JSON.stringify({
        staging: {
          backupReference: "verified-fixture",
          databaseFingerprint: databaseFingerprint(connection),
          databaseIdentity: identity,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          restoreVerifiedAt: new Date(Date.now() - 1000).toISOString(),
        },
      })
    );
    vi.stubEnv("OMS_TARGET_BINDINGS_JSON", "[]");
    return getConfig();
  }
  it("allows verified evidence with no API configured", () => {
    expect(
      requireBackupEvidence("staging", connection, config()).databaseIdentity
    ).toBe(identity);
  });
  it("rejects a different database and stale evidence", () => {
    const c = config();
    expect(() =>
      requireBackupEvidence(
        "staging",
        {
          ...connection,
          database: { ...connection.database, name: "production" },
        },
        c
      )
    ).toThrow();
    const evidence = c.backupEvidence.staging;
    if (!evidence) {
      throw new Error("Missing fixture evidence");
    }
    evidence.expiresAt = new Date(0).toISOString();
    expect(() => requireBackupEvidence("staging", connection, c)).toThrow();
  });
  it("rejects identity mismatch against an independent server binding", () => {
    const c = config();
    c.targetBindings = [
      {
        apiOrigin: "https://oms.example.test",
        database: "staging",
        databaseIdentity: "66c76f6e-79ec-43ae-8f9f-a5a08dfd056d",
        deploymentId: "staging",
        host: connection.database.host,
        port: 5432,
        safetyClass: "staging",
      },
    ];
    expect(() => requireBackupEvidence("staging", connection, c)).toThrow();
  });
});
