import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../lib/contracts";
import {
  execute,
  prepare,
  prepareRestore,
  reconcile,
} from "../../server/audit/operations";
import type { Config } from "../../server/config";
import { ManagementError } from "../../server/errors";
import { databaseFingerprint, fingerprint } from "../../server/oms-api/client";
import { Profiles } from "../../server/profiles/repository";
import type { Connection } from "../../server/profiles/schema";
import { ControlStore } from "../../server/storage/control-store";

const mocks = vi.hoisted(() => ({
  bridgeRequest: vi.fn(),
  lease: vi.fn(),
  probe: vi.fn(),
  profiles: vi.fn(),
  readTarget: vi.fn(),
  verifyBinding: vi.fn(),
}));

vi.mock("../../server/target/context", () => ({
  profiles: mocks.profiles,
  readTarget: mocks.readTarget,
}));
vi.mock("../../server/target/clients", () => ({
  clients: () => ({ lease: mocks.lease }),
}));
vi.mock("../../server/target/compatibility", () => ({ probe: mocks.probe }));
vi.mock("../../server/oms-api/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/oms-api/client")>();
  return {
    ...actual,
    bridgeRequest: mocks.bridgeRequest,
    verifyBinding: mocks.verifyBinding,
  };
});

const actor: Actor = {
  email: "operator@example.com",
  id: "operator-1",
  name: "Operator",
};
const actorB: Actor = {
  email: "recovery@example.com",
  id: "operator-2",
  name: "Recovery Operator",
};
const KEY = Buffer.alloc(32, 10).toString("base64");
const DATABASE_ID = "2c878880-ec61-43d9-a857-1ee32038a3fd";
const OTHER_DATABASE_ID = "cd6bf754-306b-4ae8-b077-01c2504a6a8e";
const API_ORIGIN = "http://127.0.0.1:4012";
const connection: Connection = {
  accountIds: ["account-1"],
  api: {
    databaseIdentity: DATABASE_ID,
    deploymentId: "fixture-deployment",
    origin: API_ORIGIN,
    token: "fixture-token",
  },
  database: {
    host: "127.0.0.1",
    name: "oms_isolation_a",
    password: "fixture-password",
    port: 5432,
    tls: false,
    user: "oms_diagnostic",
  },
  globalDiagnostics: false,
};

describe("operation persistence and recovery", () => {
  let root: string;
  let store: ControlStore;
  let repository: Profiles;
  let config: Config;
  let query: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OMS_WRITES_ENABLED", "true");
    root = mkdtempSync(join(tmpdir(), "oms-operation-test-"));
    config = {
      allowedUsers: new Set([actor.id, actorB.id]),
      allowLoopback: true,
      apiOrigins: new Set([API_ORIGIN]),
      backupEvidence: {
        "custom-op": {
          backupReference: "backup://fixture/custom-op",
          databaseFingerprint: databaseFingerprint(connection),
          databaseIdentity: DATABASE_ID,
          expiresAt: "2099-01-01T00:00:00.000Z",
          restoreVerifiedAt: "2020-01-01T00:00:00.000Z",
        },
      },
      controlPath: join(root, "control.sqlite"),
      dbHosts: new Set([connection.database.host]),
      dbPorts: new Set([connection.database.port]),
      encryptionKey: KEY,
      identityOrigin: "http://127.0.0.1:3002",
      policy: [
        {
          capabilities: ["read", "commands", "settings:write"],
          profiles: ["custom"],
          userId: actor.id,
        },
        {
          capabilities: ["read", "commands", "settings:write"],
          profiles: ["custom"],
          userId: actorB.id,
        },
      ],
      poolLimit: 1,
      profileScopes: {
        custom: { accountIds: ["account-1"], globalDiagnostics: false },
      },
      publicOrigin: "http://127.0.0.1:4010",
      targetBindings: [],
    };
    store = new ControlStore(config.controlPath, config.encryptionKey);
    const now = new Date().toISOString();
    store.db
      .prepare("INSERT INTO profiles VALUES(?,?,?,?,?,1,?,0,?)")
      .run("custom-op", 1, "Custom operation", "custom", null, null, now);
    store.db
      .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
      .run(
        "custom-op",
        1,
        store.vault.seal(
          { compatibility: null, connection },
          "profile:custom-op:1"
        ),
        1,
        now
      );
    repository = new Profiles(store, config);
    mocks.profiles.mockReturnValue(repository);
    query = vi.fn().mockResolvedValue({ rows: [] });
    release = vi.fn();
    mocks.lease.mockResolvedValue({ client: { query }, release });
    mocks.probe.mockResolvedValue({
      checkedAt: now,
      databaseIdentity: DATABASE_ID,
      features: ["logs"],
    });
    mocks.verifyBinding.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    store.close();
    rmSync(root, { force: true, recursive: true });
  });

  it("prepares and executes settings without an API and records direct routing", async () => {
    const noApi = { ...connection, api: null };
    store.db
      .prepare(
        "UPDATE revisions SET ciphertext=? WHERE profile_id='custom-op' AND revision=1"
      )
      .run(
        store.vault.seal(
          { compatibility: null, connection: noApi },
          "profile:custom-op:1"
        )
      );
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("FROM shopify_store")
        ? [
            {
              id: "store-1",
              updatedAt: new Date("2030-01-01T00:00:00.000Z"),
              webhookSignatureEncrypted: null,
            },
          ]
        : [],
    }));
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "shopify.signature.update",
        expectedVersion: "2030-01-01T00:00:00.000Z",
        payload: { signature: "", storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    const row = store.db
      .prepare("SELECT request_cipher FROM operations WHERE id=?")
      .get(prepared.operationId) as { request_cipher: string };
    expect(
      store.vault.open<{ execution: string }>(
        row.request_cipher,
        `operation:${prepared.operationId}`
      ).execution
    ).toBe("direct");
    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).resolves.toMatchObject({ status: "completed" });
    expect(mocks.bridgeRequest).not.toHaveBeenCalled();
    expect(mocks.verifyBinding).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).startsWith("INSERT INTO audit_log")
      )
    ).toBe(true);
  });

  it("reconciles an uncertain direct commit from a DB receipt without calling OMS", async () => {
    const noApi = { ...connection, api: null };
    store.db
      .prepare(
        "UPDATE revisions SET ciphertext=? WHERE profile_id='custom-op' AND revision=1"
      )
      .run(
        store.vault.seal(
          { compatibility: null, connection: noApi },
          "profile:custom-op:1"
        )
      );
    query.mockImplementation((sql: string) => {
      if (sql === "COMMIT") {
        return Promise.reject(new Error("connection lost after commit"));
      }
      return Promise.resolve({
        rows: sql.includes("FROM shopify_store")
          ? [{ id: "store-1", updatedAt: new Date("2030-01-01T00:00:00.000Z") }]
          : [],
      });
    });
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "shopify.signature.update",
        expectedVersion: "2030-01-01T00:00:00.000Z",
        payload: { signature: "", storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "operation_unknown" });
    const saved = store.db
      .prepare("SELECT payload_hash FROM operations WHERE id=?")
      .get(prepared.operationId) as { payload_hash: string };
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT action,metadata")
        ? [
            {
              action: "management.direct.shopify.signature.update",
              metadata: {
                externalActor: { subject: actor.id },
                payloadHash: saved.payload_hash,
              },
            },
          ]
        : [],
    }));
    await expect(
      reconcile(actorB, prepared.operationId, config)
    ).resolves.toMatchObject({ status: "completed" });
    expect(mocks.bridgeRequest).not.toHaveBeenCalled();
  });

  it("refuses restore from the old database after a no-API endpoint is replaced", async () => {
    const noApi = { ...connection, api: null, globalDiagnostics: true };
    config.profileScopes.custom = {
      accountIds: ["account-1"],
      globalDiagnostics: true,
    };
    store.db
      .prepare(
        "UPDATE revisions SET ciphertext=? WHERE profile_id='custom-op' AND revision=1"
      )
      .run(
        store.vault.seal(
          { compatibility: null, connection: noApi },
          "profile:custom-op:1"
        )
      );
    query.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes("FROM shopify_store")
          ? [{ id: "store-1", updatedAt: new Date("2030-01-01T00:00:00.000Z") }]
          : [],
      })
    );
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "shopify.signature.update",
        expectedVersion: "2030-01-01T00:00:00.000Z",
        payload: { signature: "", storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    store.db
      .prepare(
        "UPDATE operations SET action='maintenance.update',state='completed' WHERE id=?"
      )
      .run(prepared.operationId);
    const evidence = config.backupEvidence["custom-op"];
    if (!evidence) {
      throw new Error("Missing fixture backup");
    }
    evidence.databaseIdentity = OTHER_DATABASE_ID;
    mocks.probe.mockResolvedValue({
      databaseIdentity: OTHER_DATABASE_ID,
      features: ["maintenance"],
    });
    mocks.readTarget.mockImplementation((_actor, _ref, _config, _feature, fn) =>
      fn({ query }, noApi)
    );
    await expect(
      prepareRestore(actor, prepared.operationId, config)
    ).rejects.toMatchObject({ code: "backup_target_changed" });
    expect(mocks.bridgeRequest).not.toHaveBeenCalled();
  });

  it("rejects a replaced DB identity before preparing a direct setting", async () => {
    mocks.probe.mockResolvedValue({
      databaseIdentity: OTHER_DATABASE_ID,
      features: ["logs"],
    });
    await expect(
      prepare(
        actor,
        {
          accountId: "account-1",
          action: "shopify.signature.update",
          expectedVersion: null,
          payload: { signature: "", storeId: "store-1" },
          profileId: "custom-op",
          revision: 1,
        },
        config
      )
    ).rejects.toMatchObject({ code: "database_identity_mismatch" });
    expect(mocks.bridgeRequest).not.toHaveBeenCalled();
  });

  it("persists prepared placeholder-like payload and executes the confirmed envelope", async () => {
    const payload = {
      note: "'); DROP TABLE operations; --",
      storeId: "store-1",
    };
    mocks.bridgeRequest.mockImplementation(
      (_connection: Connection, _config: Config, path: string) => {
        if (path === "preview") {
          return { before: { updatedAt: "2030-01-01T00:00:00.000Z" } };
        }
        if (path === "commands") {
          return { status: "completed" };
        }
        throw new Error(`Unexpected bridge path: ${path}`);
      }
    );

    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload,
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    const stored = store.db
      .prepare("SELECT state,request_cipher FROM operations WHERE id=?")
      .get(prepared.operationId) as { request_cipher: string; state: string };

    expect(stored.state).toBe("prepared");
    expect(
      store.vault.open<{ input: { payload: unknown } }>(
        stored.request_cipher,
        `operation:${prepared.operationId}`
      ).input.payload
    ).toEqual(payload);
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM operations").get()
    ).toEqual({ count: 1 });
    expect(
      store.db
        .prepare(
          "SELECT backup_reference,target_fingerprint FROM backup_evidence WHERE operation_id=?"
        )
        .get(prepared.operationId)
    ).toEqual({
      backup_reference: "backup://fixture/custom-op",
      target_fingerprint: databaseFingerprint(connection),
    });

    await expect(
      execute(actorB, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "operation_not_found", status: 404 });

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).resolves.toMatchObject({ status: "completed" });
    const commandCall = mocks.bridgeRequest.mock.calls.find(
      (call) => call[2] === "commands"
    );
    expect(commandCall?.[3]).toMatchObject({
      actor: { issuer: "wizdek", subject: actor.id },
      operationId: prepared.operationId,
      payload,
      profileId: "custom-op",
      revision: 1,
    });
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("marks an uncertain command unknown and reconciles against its retained revision", async () => {
    mocks.bridgeRequest.mockImplementation(
      (_connection: Connection, _config: Config, path: string) => {
        if (path === "preview") {
          return { before: { updatedAt: "2030-01-01T00:00:00.000Z" } };
        }
        if (path === "commands") {
          throw new Error("connection closed after dispatch");
        }
        if (path === "status") {
          return { status: "completed" };
        }
        throw new Error(`Unexpected bridge path: ${path}`);
      }
    );
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "operation_unknown", status: 502 });
    expect(
      store.db
        .prepare("SELECT state FROM operations WHERE id=?")
        .get(prepared.operationId)
    ).toEqual({ state: "unknown" });

    const now = new Date().toISOString();
    const replacement = {
      ...connection,
      database: { ...connection.database, name: "replacement_database" },
    };
    store.db
      .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
      .run(
        "custom-op",
        2,
        store.vault.seal(
          { compatibility: null, connection: replacement },
          "profile:custom-op:2"
        ),
        1,
        now
      );
    store.db
      .prepare(
        "UPDATE profiles SET revision=2,updated_at=? WHERE id='custom-op'"
      )
      .run(now);

    await expect(
      reconcile(actorB, prepared.operationId, config)
    ).resolves.toMatchObject({
      operationId: prepared.operationId,
      status: "completed",
    });
    const recoveryLease = mocks.lease.mock.calls.at(-1);
    expect(recoveryLease?.[0]).toBe("custom-op:1");
    expect(recoveryLease?.[1]).toMatchObject({
      database: { name: "oms_isolation_a" },
    });
    expect(recoveryLease?.[3]).toBe(true);
    const statusCall = mocks.bridgeRequest.mock.calls.find(
      (call) => call[2] === "status"
    );
    expect(statusCall?.[3]).toMatchObject({
      actor: { issuer: "wizdek", subject: actor.id },
    });
    expect(
      store.db
        .prepare("SELECT state FROM operations WHERE id=?")
        .get(prepared.operationId)
    ).toEqual({ state: "completed" });
  });

  it.each([
    ["missing", undefined],
    [
      "expired",
      {
        backupReference: "backup://fixture/expired",
        databaseFingerprint: databaseFingerprint(connection),
        databaseIdentity: DATABASE_ID,
        expiresAt: "2021-01-01T00:00:00.000Z",
        restoreVerifiedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
  ])("denies prepare when backup evidence is %s", async (_label, evidence) => {
    config.backupEvidence = evidence ? { "custom-op": evidence } : {};

    await expect(
      prepare(
        actor,
        {
          accountId: "account-1",
          action: "fraud.review",
          expectedVersion: null,
          payload: { storeId: "store-1" },
          profileId: "custom-op",
          revision: 1,
        },
        config
      )
    ).rejects.toMatchObject({ code: "backup_required", status: 409 });
    expect(mocks.lease).not.toHaveBeenCalled();
  });

  it("rejects a tampered encrypted snapshot before accepting execution", async () => {
    mocks.bridgeRequest.mockResolvedValue({
      before: { updatedAt: "2030-01-01T00:00:00.000Z" },
    });
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    store.db
      .prepare("UPDATE backup_evidence SET checksum=? WHERE operation_id=?")
      .run("0".repeat(64), prepared.operationId);

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "backup_invalid", status: 409 });
    expect(
      store.db
        .prepare("SELECT state FROM operations WHERE id=?")
        .get(prepared.operationId)
    ).toEqual({ state: "prepared" });
  });

  it.each([
    "execute",
    "reconcile",
  ])("pins the discovered DB for token-only bridge %s", async (step) => {
    const tokenOnly = {
      ...connection,
      api: { origin: API_ORIGIN, token: "fixture-token" },
    };
    store.db
      .prepare(
        "UPDATE revisions SET ciphertext=? WHERE profile_id='custom-op' AND revision=1"
      )
      .run(
        store.vault.seal(
          { compatibility: null, connection: tokenOnly },
          "profile:custom-op:1"
        )
      );
    mocks.bridgeRequest.mockResolvedValue({
      before: { updatedAt: "2030-01-01T00:00:00.000Z" },
    });
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { orderId: "order-1", riskLevel: "LOW" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    const row = store.db
      .prepare("SELECT request_cipher FROM operations WHERE id=?")
      .get(prepared.operationId) as { request_cipher: string };
    expect(
      store.vault.open<{ databaseIdentity: string }>(
        row.request_cipher,
        `operation:${prepared.operationId}`
      ).databaseIdentity
    ).toBe(DATABASE_ID);
    mocks.bridgeRequest.mockClear();
    mocks.probe.mockResolvedValue({
      databaseIdentity: OTHER_DATABASE_ID,
      features: ["logs"],
    });
    if (step === "reconcile") {
      store.db
        .prepare("UPDATE operations SET state='unknown' WHERE id=?")
        .run(prepared.operationId);
      await expect(
        reconcile(actor, prepared.operationId, config)
      ).rejects.toMatchObject({ code: "database_identity_mismatch" });
    } else {
      await expect(
        execute(actor, prepared.operationId, prepared.confirmation, "", config)
      ).rejects.toMatchObject({ code: "operation_rejected" });
    }
    expect(mocks.bridgeRequest).not.toHaveBeenCalled();
  });

  it("rejects the same endpoint when its database identity changes", async () => {
    mocks.bridgeRequest.mockResolvedValue({
      before: { updatedAt: "2030-01-01T00:00:00.000Z" },
    });
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    const changedIdentity = {
      ...connection,
      api: {
        databaseIdentity: OTHER_DATABASE_ID,
        deploymentId: "fixture-deployment",
        origin: API_ORIGIN,
        token: "fixture-token",
      },
    };
    store.db
      .prepare(
        "UPDATE revisions SET ciphertext=? WHERE profile_id='custom-op' AND revision=1"
      )
      .run(
        store.vault.seal(
          { compatibility: null, connection: changedIdentity },
          "profile:custom-op:1"
        )
      );

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "backup_required", status: 409 });
  });

  it("rejects a snapshot envelope bound to the wrong database identity", async () => {
    mocks.bridgeRequest.mockResolvedValue({
      before: { updatedAt: "2030-01-01T00:00:00.000Z" },
    });
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    const row = store.db
      .prepare("SELECT ciphertext FROM backup_evidence WHERE operation_id=?")
      .get(prepared.operationId) as { ciphertext: string };
    const envelope = store.vault.open<{
      databaseIdentity: string;
      snapshot: unknown;
    }>(row.ciphertext, `backup:${prepared.operationId}`);
    const wrongEnvelope = {
      ...envelope,
      databaseIdentity: OTHER_DATABASE_ID,
    };
    store.db
      .prepare(
        "UPDATE backup_evidence SET ciphertext=?,checksum=? WHERE operation_id=?"
      )
      .run(
        store.vault.seal(wrongEnvelope, `backup:${prepared.operationId}`),
        fingerprint(wrongEnvelope),
        prepared.operationId
      );

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "backup_target_changed", status: 409 });
  });

  it("retains bridge recovery for a settings operation created before direct routing", async () => {
    mocks.bridgeRequest.mockResolvedValue({
      before: { updatedAt: "2030-01-01T00:00:00.000Z" },
    });
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    const row = store.db
      .prepare("SELECT request_cipher FROM operations WHERE id=?")
      .get(prepared.operationId) as { request_cipher: string };
    const old = store.vault.open<Record<string, unknown>>(
      row.request_cipher,
      `operation:${prepared.operationId}`
    );
    old.execution = undefined;
    old.input = {
      ...(old.input as Record<string, unknown>),
      action: "shopify.app.update",
    };
    store.db
      .prepare(
        "UPDATE operations SET action='shopify.app.update',state='unknown',request_cipher=? WHERE id=?"
      )
      .run(
        store.vault.seal(old, `operation:${prepared.operationId}`),
        prepared.operationId
      );
    mocks.bridgeRequest.mockResolvedValue({ status: "completed" });
    await expect(
      reconcile(actor, prepared.operationId, config)
    ).resolves.toMatchObject({ status: "completed" });
    expect(mocks.bridgeRequest.mock.calls.at(-1)?.[2]).toBe("status");
  });

  it("marks a definitive bridge rejection failed", async () => {
    mocks.bridgeRequest.mockImplementation(
      (_connection: Connection, _config: Config, path: string) => {
        if (path === "preview") {
          return { before: { updatedAt: "2030-01-01T00:00:00.000Z" } };
        }
        if (path === "commands") {
          throw new ManagementError(
            "bridge_rejected_definitive",
            "Command was rejected before execution.",
            409
          );
        }
        throw new Error(`Unexpected bridge path: ${path}`);
      }
    );
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "operation_rejected", status: 409 });
    expect(
      store.db
        .prepare("SELECT state FROM operations WHERE id=?")
        .get(prepared.operationId)
    ).toEqual({ state: "failed" });
  });

  it("reconciles a not-executed receipt to failed for another authorized operator", async () => {
    mocks.bridgeRequest.mockImplementation(
      (_connection: Connection, _config: Config, path: string) => {
        if (path === "preview") {
          return { before: { updatedAt: "2030-01-01T00:00:00.000Z" } };
        }
        if (path === "commands") {
          throw new Error("transport closed after dispatch");
        }
        if (path === "status") {
          return { status: "not_executed" };
        }
        throw new Error(`Unexpected bridge path: ${path}`);
      }
    );
    const prepared = await prepare(
      actor,
      {
        accountId: "account-1",
        action: "fraud.review",
        expectedVersion: null,
        payload: { storeId: "store-1" },
        profileId: "custom-op",
        revision: 1,
      },
      config
    );
    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "operation_unknown", status: 502 });

    await expect(
      reconcile(actorB, prepared.operationId, config)
    ).resolves.toMatchObject({ status: "failed" });
    expect(
      store.db
        .prepare("SELECT state FROM operations WHERE id=?")
        .get(prepared.operationId)
    ).toEqual({ state: "failed" });
    const statusCall = mocks.bridgeRequest.mock.calls.find(
      (call) => call[2] === "status"
    );
    expect(statusCall?.[3]).toMatchObject({
      actor: { issuer: "wizdek", subject: actor.id },
    });
  });
});
