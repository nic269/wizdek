import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../lib/contracts";
import {
  execute,
  prepare,
  prepareRestore,
} from "../../server/audit/operations";
import type { Config } from "../../server/config";
import { databaseFingerprint } from "../../server/oms-api/client";
import { Profiles } from "../../server/profiles/repository";
import type { Connection, ProfileEdit } from "../../server/profiles/schema";
import {
  accountOptions,
  workflowBundle,
  workflowDetail,
  workflowOptions,
  workflowRuns,
} from "../../server/services/diagnostics";
import { workflowImportFile } from "../../server/services/workflow-import-file";
import {
  type ControlStore,
  controlStore,
} from "../../server/storage/control-store";
import { ClientRegistry, clients } from "../../server/target/clients";
import { probe } from "../../server/target/compatibility";
import {
  type PostgresFixture,
  preparePostgresFixture,
} from "../fixtures/postgres";

const bindingMocks = vi.hoisted(() => ({ verifyBinding: vi.fn() }));

vi.mock("../../server/oms-api/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/oms-api/client")>();
  return { ...actual, verifyBinding: bindingMocks.verifyBinding };
});

const adminUrl = process.env.OMS_TEST_POSTGRES_URL;
if (!adminUrl) {
  throw new Error(
    "OMS_TEST_POSTGRES_URL is required for the disposable Postgres suite."
  );
}

const actor: Actor = {
  email: "operator@example.com",
  id: "operator-1",
  name: "Operator",
};
const KEY = Buffer.alloc(32, 9).toString("base64");
const DATABASE_ID = "2c878880-ec61-43d9-a857-1ee32038a3fd";
const API_ORIGIN = "http://127.0.0.1:4012";

describe("Postgres target isolation", () => {
  let fixture: PostgresFixture;
  let root: string;
  let store: ControlStore;
  let config: Config;
  let maintenanceConnection: Connection;
  let targetAdmin: Pool;

  beforeAll(async () => {
    fixture = await preparePostgresFixture(adminUrl);
    root = mkdtempSync(join(tmpdir(), "oms-profile-integration-"));
    maintenanceConnection = {
      ...fixture.connections.oms_isolation_a,
      api: {
        databaseIdentity: DATABASE_ID,
        deploymentId: "fixture-deployment",
        origin: API_ORIGIN,
        token: "fixture-token",
      },
      globalDiagnostics: true,
    };
    config = {
      allowedUsers: new Set([actor.id]),
      allowLoopback: true,
      apiOrigins: new Set([API_ORIGIN]),
      backupEvidence: {
        maintenance: {
          backupReference: "backup://fixture/maintenance",
          databaseFingerprint: databaseFingerprint(maintenanceConnection),
          databaseIdentity: DATABASE_ID,
          expiresAt: "2099-01-01T00:00:00.000Z",
          restoreVerifiedAt: "2020-01-01T00:00:00.000Z",
        },
      },
      controlPath: join(root, "control.sqlite"),
      dbHosts: new Set(["127.0.0.1"]),
      dbPorts: new Set([fixture.port]),
      encryptionKey: KEY,
      identityOrigin: "http://127.0.0.1:3002",
      policy: [
        {
          capabilities: ["read", "profiles:edit", "settings:write"],
          profiles: ["*"],
          userId: actor.id,
        },
      ],
      poolLimit: 2,
      profileScopes: {
        custom: { accountIds: ["account-1"], globalDiagnostics: false },
        maintenance: {
          accountIds: ["account-1"],
          globalDiagnostics: true,
        },
      },
      publicOrigin: "http://127.0.0.1:4010",
      targetBindings: [],
    };
    store = controlStore(config);
    const now = new Date().toISOString();
    store.db
      .prepare("INSERT INTO profiles VALUES(?,?,?,?,?,1,?,0,?)")
      .run("maintenance", 1, "Maintenance", "custom", null, null, now);
    store.db
      .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
      .run(
        "maintenance",
        1,
        store.vault.seal(
          { compatibility: null, connection: maintenanceConnection },
          "profile:maintenance:1"
        ),
        1,
        now
      );
    const targetAdminUrl = new URL(fixture.adminUrl);
    targetAdminUrl.pathname = "/oms_isolation_a";
    targetAdmin = new Pool({
      connectionString: targetAdminUrl.toString(),
      max: 1,
    });
    bindingMocks.verifyBinding.mockResolvedValue({});
    vi.stubEnv("OMS_WRITES_ENABLED", "true");
  });

  afterAll(async () => {
    await clients(config).close();
    await targetAdmin.end();
    store.close();
    Reflect.deleteProperty(globalThis, "omsControlStore");
    vi.unstubAllEnvs();
    rmSync(root, { force: true, recursive: true });
  });

  const resetMaintenance = async (
    value: { enabled: boolean; exceptions: string[] } | null
  ) => {
    await targetAdmin.query("DELETE FROM audit_log");
    await targetAdmin.query(
      "DELETE FROM site_setting WHERE key='maintenanceMode'"
    );
    if (value) {
      await targetAdmin.query(
        `INSERT INTO site_setting(key,value,"createdAt","updatedAt")
         VALUES('maintenanceMode',$1,NOW(),date_trunc('milliseconds',NOW()))`,
        [JSON.stringify(value)]
      );
    }
  };

  it("executes maintenance CAS with audit and restores the encrypted before-snapshot", async () => {
    const before = { enabled: false, exceptions: ["/health"] };
    const after = { enabled: true, exceptions: ["/admin"] };
    await resetMaintenance(before);
    const initial = await targetAdmin.query(
      'SELECT "updatedAt" FROM site_setting WHERE key=$1',
      ["maintenanceMode"]
    );
    const expectedVersion = initial.rows[0].updatedAt.toISOString();

    const prepared = await prepare(
      actor,
      {
        action: "maintenance.update",
        expectedVersion,
        payload: after,
        profileId: "maintenance",
        revision: 1,
      },
      config
    );
    const evidence = store.db
      .prepare(
        "SELECT ciphertext,checksum FROM backup_evidence WHERE operation_id=?"
      )
      .get(prepared.operationId) as { checksum: string; ciphertext: string };
    expect(evidence.checksum).toHaveLength(64);
    expect(
      store.vault.open<{
        databaseIdentity: string;
        snapshot: { before: { value: unknown } };
      }>(evidence.ciphertext, `backup:${prepared.operationId}`).snapshot.before
        .value
    ).toEqual(before);

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).resolves.toMatchObject({ status: "completed" });
    const changed = await targetAdmin.query(
      "SELECT value FROM site_setting WHERE key=$1",
      ["maintenanceMode"]
    );
    expect(JSON.parse(changed.rows[0].value)).toEqual(after);
    const audit = await targetAdmin.query(
      'SELECT "actorId",action,metadata FROM audit_log WHERE id=$1',
      [prepared.operationId]
    );
    expect(audit.rows[0]).toMatchObject({
      action: "management.maintenance.update",
      actorId: null,
      metadata: {
        externalActor: { issuer: "wizdek", subject: actor.id },
        operationId: prepared.operationId,
      },
    });

    const restore = await prepareRestore(actor, prepared.operationId, config);
    await expect(
      execute(actor, restore.operationId, restore.confirmation, "", config)
    ).resolves.toMatchObject({ status: "completed" });
    const restored = await targetAdmin.query(
      "SELECT value FROM site_setting WHERE key=$1",
      ["maintenanceMode"]
    );
    expect(JSON.parse(restored.rows[0].value)).toEqual(before);
  });

  it("rejects stale maintenance CAS without changing the target", async () => {
    const before = { enabled: false, exceptions: [] };
    const external = { enabled: true, exceptions: ["/external"] };
    await resetMaintenance(before);
    const initial = await targetAdmin.query(
      'SELECT "updatedAt" FROM site_setting WHERE key=$1',
      ["maintenanceMode"]
    );
    const prepared = await prepare(
      actor,
      {
        action: "maintenance.update",
        expectedVersion: initial.rows[0].updatedAt.toISOString(),
        payload: { enabled: true, exceptions: ["/ours"] },
        profileId: "maintenance",
        revision: 1,
      },
      config
    );
    await targetAdmin.query(
      `UPDATE site_setting
       SET value=$1,"updatedAt"=date_trunc('milliseconds',"updatedAt" + interval '1 second')
       WHERE key='maintenanceMode'`,
      [JSON.stringify(external)]
    );

    await expect(
      execute(actor, prepared.operationId, prepared.confirmation, "", config)
    ).rejects.toMatchObject({ code: "operation_rejected", status: 409 });
    const unchanged = await targetAdmin.query(
      "SELECT value FROM site_setting WHERE key=$1",
      ["maintenanceMode"]
    );
    expect(JSON.parse(unchanged.rows[0].value)).toEqual(external);
    const audit = await targetAdmin.query(
      "SELECT id FROM audit_log WHERE id=$1",
      [prepared.operationId]
    );
    expect(audit.rows).toEqual([]);
  });

  it("restores an originally absent maintenance row back to absence", async () => {
    await resetMaintenance(null);
    const prepared = await prepare(
      actor,
      {
        action: "maintenance.update",
        expectedVersion: null,
        payload: { enabled: true, exceptions: ["/temporary"] },
        profileId: "maintenance",
        revision: 1,
      },
      config
    );
    await execute(
      actor,
      prepared.operationId,
      prepared.confirmation,
      "",
      config
    );
    const created = await targetAdmin.query(
      "SELECT value FROM site_setting WHERE key='maintenanceMode'"
    );
    expect(created.rows).toHaveLength(1);

    const restore = await prepareRestore(actor, prepared.operationId, config);
    expect(restore.after).toEqual({ absent: true });
    await expect(
      execute(actor, restore.operationId, restore.confirmation, "", config)
    ).resolves.toMatchObject({ status: "completed" });
    const restored = await targetAdmin.query(
      "SELECT value FROM site_setting WHERE key='maintenanceMode'"
    );
    expect(restored.rows).toEqual([]);

    const operationCount = store.db
      .prepare("SELECT COUNT(*) AS count FROM operations")
      .get();
    const auditCount = store.db
      .prepare("SELECT COUNT(*) AS count FROM audit")
      .get();
    await expect(
      prepareRestore(actor, prepared.operationId, config)
    ).rejects.toMatchObject({ code: "restore_no_change", status: 409 });
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM operations").get()
    ).toEqual(operationCount);
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM audit").get()
    ).toEqual(auditCount);
  });

  it("keeps identical row IDs isolated between database pools", async () => {
    const registry = new ClientRegistry(2);
    const first = await registry.lease(
      "database-a",
      fixture.connections.oms_isolation_a,
      config
    );
    const second = await registry.lease(
      "database-b",
      fixture.connections.oms_isolation_b,
      config
    );
    try {
      const [a, b] = await Promise.all([
        first.client.query(
          "SELECT id,title FROM workflow_run WHERE id='shared-id'"
        ),
        second.client.query(
          "SELECT id,title FROM workflow_run WHERE id='shared-id'"
        ),
      ]);
      expect(a.rows).toEqual([{ id: "shared-id", title: "database-1" }]);
      expect(b.rows).toEqual([{ id: "shared-id", title: "database-2" }]);
    } finally {
      first.release();
      second.release();
      await registry.close();
    }
  });

  it("keeps actual workflow DTOs isolated for identical IDs", async () => {
    const firstPool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_a,
      max: 1,
    });
    const secondPool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_b,
      max: 1,
    });
    const first = await firstPool.connect();
    const second = await secondPool.connect();
    try {
      const [aList, bList, aDetail, bDetail] = await Promise.all([
        workflowRuns(first, fixture.connections.oms_isolation_a, {
          search: "shared-id",
        }),
        workflowRuns(second, fixture.connections.oms_isolation_b, {
          search: "shared-id",
        }),
        workflowDetail(
          first,
          fixture.connections.oms_isolation_a,
          "shared-id",
          0
        ),
        workflowDetail(
          second,
          fixture.connections.oms_isolation_b,
          "shared-id",
          0
        ),
      ]);

      expect(aList).toMatchObject({
        rows: [{ id: "shared-id", title: "database-1" }],
      });
      expect(bList).toMatchObject({
        rows: [{ id: "shared-id", title: "database-2" }],
      });
      expect(aDetail).toMatchObject({
        logs: [{ message: "log-database-1" }],
        run: { id: "shared-id", title: "database-1" },
      });
      expect(bDetail).toMatchObject({
        logs: [{ message: "log-database-2" }],
        run: { id: "shared-id", title: "database-2" },
      });
    } finally {
      first.release();
      second.release();
      await firstPool.end();
      await secondPool.end();
    }
  });

  it("serializes pagination cursors and enforces account scope", async () => {
    const pool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_a,
      max: 1,
    });
    const client = await pool.connect();
    try {
      const firstPage = (await workflowRuns(
        client,
        fixture.connections.oms_isolation_a,
        { limit: 2 }
      )) as {
        next: { cursorDate: string; cursorId: string };
        rows: Array<{ id: string }>;
      };
      expect(firstPage.rows).toHaveLength(2);
      expect(firstPage.next.cursorDate).toBe("2029-12-31T23:59:59.000Z");
      expect(typeof firstPage.next.cursorDate).toBe("string");

      const secondPage = (await workflowRuns(
        client,
        fixture.connections.oms_isolation_a,
        { ...firstPage.next, limit: 2 }
      )) as { rows: Array<{ id: string }> };
      expect(secondPage.rows).toHaveLength(2);
      expect(secondPage.rows.map((row) => row.id)).not.toContain(
        firstPage.rows[1]?.id
      );

      const deniedConnection = {
        ...fixture.connections.oms_isolation_a,
        accountIds: ["account-2"],
      };
      await expect(
        workflowDetail(client, deniedConnection, "shared-id", 0)
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
      await expect(
        workflowRuns(
          client,
          { ...fixture.connections.oms_isolation_a, accountIds: [] },
          { limit: 1 }
        )
      ).rejects.toMatchObject({ code: "account_scope_required", status: 403 });
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("preserves workflow summary, full payloads, bundle pagination and scoped options", async () => {
    const pool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_a,
      max: 1,
    });
    const client = await pool.connect();
    try {
      const connection = fixture.connections.oms_isolation_a;
      const list = await workflowRuns(client, connection, {
        search: "batch-parity",
      });
      expect(list).toMatchObject({
        rows: [
          {
            actor: { email: "workflow@example.test" },
            durationMs: 12_345,
            errorCount: 1,
            id: "parity-run",
            logCount: 105,
            logs: [{ id: "parity-log-105" }],
          },
        ],
      });
      expect(
        await workflowRuns(client, connection, { search: "parity.example" })
      ).toMatchObject({ rows: [{ id: "parity-run" }] });
      expect(await workflowOptions(client, connection)).toMatchObject({
        modules: expect.arrayContaining(["IMPORT_EXPORT"]),
        timeZone: "Asia/Saigon",
      });
      const detail = (await workflowDetail(
        client,
        connection,
        "parity-run",
        0
      )) as {
        logs: Array<{ metadata: { payload: string; accessToken: string } }>;
      };
      expect(detail).toMatchObject({
        nextSequence: 100,
        run: { logCount: 105 },
      });
      expect(detail.logs).toHaveLength(100);
      expect(detail.logs[0]?.metadata.payload).toHaveLength(20_000);
      expect(detail.logs[0]?.metadata.accessToken).toBe("[redacted]");
      expect(
        await workflowDetail(client, connection, "parity-run", 100)
      ).toMatchObject({ logs: expect.any(Array), nextSequence: null });
      const bundle = (await workflowBundle(
        client,
        connection,
        "parity-run"
      )) as { run: { logs: unknown[] } };
      expect(bundle.run.logs).toHaveLength(105);
      expect(
        await workflowOptions(client, {
          ...connection,
          accountIds: ["account-2"],
        })
      ).toMatchObject({ featureKeys: [], modules: [] });
      await expect(
        workflowBundle(
          client,
          { ...connection, accountIds: ["account-2"] },
          "parity-run"
        )
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("downloads original DB files without API and rejects a foreign account before file access", async () => {
    const pool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_a,
      max: 1,
    });
    const client = await pool.connect();
    try {
      const file = await workflowImportFile(
        client,
        fixture.connections.oms_isolation_a,
        "parity-run"
      );
      expect(file.content.toString()).toBe("ORDER#\nORDER-123\n");
      expect(file.disposition).toBe('attachment; filename="original.csv"');
      await expect(
        workflowImportFile(
          client,
          { ...fixture.connections.oms_isolation_a, accountIds: ["account-2"] },
          "parity-run"
        )
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("keeps a 100k-row diagnostics query bounded to one page", async () => {
    const pool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_a,
      max: 1,
    });
    const client = await pool.connect();
    try {
      const explained = await client.query(
        `EXPLAIN (FORMAT JSON)
         SELECT id,"accountId","createdAt" FROM workflow_run
         WHERE "accountId" = ANY($1::text[])
         ORDER BY "createdAt" DESC,id DESC LIMIT 101`,
        [["account-1"]]
      );
      const plan = explained.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
      expect(plan?.["Node Type"]).toBe("Limit");

      const page = (await workflowRuns(
        client,
        fixture.connections.oms_isolation_a,
        { limit: 100, module: "bulk" }
      )) as { next: unknown; rows: unknown[] };
      expect(page.rows).toHaveLength(100);
      expect(page.next).not.toBeNull();
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("accepts the restricted diagnostic role and rejects writes in read-only mode", async () => {
    const pool = new Pool({
      connectionString: fixture.diagnosticUrls.oms_isolation_a,
      max: 1,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await expect(probe(client)).resolves.toMatchObject({
        features: expect.arrayContaining(["logs", "cron"]),
      });
      await expect(
        client.query(
          "INSERT INTO workflow_run(id,\"accountId\",module,\"featureKey\",status,title,\"createdAt\") VALUES('write-attempt','a','m','f','new','blocked',NOW())"
        )
      ).rejects.toMatchObject({ code: "25006" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("accepts an existing database role with OMS read permissions", async () => {
    const pool = new Pool({
      connectionString: fixture.overprivilegedUrl,
      max: 1,
    });
    const client = await pool.connect();
    try {
      await expect(probe(client)).resolves.toMatchObject({
        features: expect.arrayContaining(["logs", "cron", "accounts"]),
      });
      const scoped = await accountOptions(
        client,
        fixture.connections.oms_isolation_a
      );
      expect(scoped.rows.map((row) => row.id)).toEqual(["account-1"]);
      expect(scoped.rows[0].users).toEqual([
        { email: "operator@example.test", name: "OMS Operator" },
      ]);
      const all = await accountOptions(client, {
        ...fixture.connections.oms_isolation_a,
        accountIds: [],
        globalDiagnostics: true,
      });
      expect(all.rows).toHaveLength(2);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("shares a cold pool initialization between simultaneous readers", async () => {
    const registry = new ClientRegistry(1);
    const [first, second] = await Promise.all([
      registry.lease(
        "same-target",
        fixture.connections.oms_isolation_a,
        config
      ),
      registry.lease(
        "same-target",
        fixture.connections.oms_isolation_a,
        config
      ),
    ]);
    try {
      const results = await Promise.all([
        first.client.query("SELECT current_database() AS name"),
        second.client.query("SELECT current_database() AS name"),
      ]);
      expect(results.map((result) => result.rows[0].name)).toEqual([
        "oms_isolation_a",
        "oms_isolation_a",
      ]);
    } finally {
      first.release();
      second.release();
      await registry.close();
    }
  });

  it("never evicts an in-use pool when the registry reaches its bound", async () => {
    const registry = new ClientRegistry(1);
    const active = await registry.lease(
      "database-a",
      fixture.connections.oms_isolation_a,
      config
    );
    await expect(
      registry.lease("database-b", fixture.connections.oms_isolation_b, config)
    ).rejects.toMatchObject({ code: "pool_capacity", status: 503 });

    active.release();
    const replacement = await registry.lease(
      "database-b",
      fixture.connections.oms_isolation_b,
      config
    );
    try {
      await expect(
        replacement.client.query("SELECT current_database() AS name")
      ).resolves.toMatchObject({ rows: [{ name: "oms_isolation_b" }] });
    } finally {
      replacement.release();
      await registry.close();
    }
  });

  it("uses CAS revisions and retains old encrypted revisions", async () => {
    const profiles = new Profiles(store, config);
    const initial: ProfileEdit = {
      accountIds: ["account-1"],
      api: null,
      database: {
        host: "127.0.0.1",
        name: "oms_isolation_a",
        password: { mode: "replace", value: "diagnostic_password" },
        port: fixture.port,
        tls: false,
        user: "oms_diagnostic",
      },
      expectedRevision: 0,
      globalDiagnostics: false,
      id: "custom-a",
      name: "Custom A v1",
    };

    await expect(profiles.save(actor, initial)).resolves.toMatchObject({
      revision: 1,
    });
    const concurrentEdits = await Promise.allSettled([
      profiles.save(actor, {
        ...initial,
        database: { ...initial.database, password: { mode: "keep" } },
        expectedRevision: 1,
        name: "Concurrent edit A",
      }),
      profiles.save(actor, {
        ...initial,
        database: { ...initial.database, password: { mode: "keep" } },
        expectedRevision: 1,
        name: "Concurrent edit B",
      }),
    ]);

    expect(
      concurrentEdits.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      concurrentEdits.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(
      concurrentEdits.find((result) => result.status === "rejected")
    ).toMatchObject({
      reason: { code: "revision_conflict", status: 409 },
    });

    expect(
      profiles.revision({ profileId: "custom-a", revision: 1 })
    ).toMatchObject({
      connection: { database: { name: "oms_isolation_a" } },
    });
    expect(
      profiles.revision({ profileId: "custom-a", revision: 2 })
    ).toMatchObject({
      connection: { database: { password: "diagnostic_password" } },
    });
  });

  it("rejects custom profile scope above the operator-owned ceiling", async () => {
    const profiles = new Profiles(store, config);
    const base: ProfileEdit = {
      accountIds: ["account-1"],
      api: null,
      database: {
        host: "127.0.0.1",
        name: "oms_isolation_a",
        password: { mode: "replace", value: "diagnostic_password" },
        port: fixture.port,
        tls: false,
        user: "oms_diagnostic",
      },
      expectedRevision: 0,
      globalDiagnostics: false,
      id: "custom-scope",
      name: "Custom scope",
    };

    await expect(
      profiles.save(actor, { ...base, accountIds: ["account-1", "account-2"] })
    ).rejects.toMatchObject({ code: "scope_denied", status: 403 });
    await expect(
      profiles.save(actor, { ...base, globalDiagnostics: true })
    ).rejects.toMatchObject({ code: "scope_denied", status: 403 });
  });

  it("blocks profile save and disable while a read lease is active", async () => {
    const profiles = new Profiles(store, config);
    const initial: ProfileEdit = {
      accountIds: ["account-1"],
      api: null,
      database: {
        host: "127.0.0.1",
        name: "oms_isolation_a",
        password: { mode: "replace", value: "diagnostic_password" },
        port: fixture.port,
        tls: false,
        user: "oms_diagnostic",
      },
      expectedRevision: 0,
      globalDiagnostics: false,
      id: "custom-readers",
      name: "Reader guarded v1",
    };
    await profiles.save(actor, initial);

    const firstRead = profiles.acquire(actor, {
      profileId: initial.id,
      revision: 1,
    });
    expect(() =>
      profiles.disable(actor, { profileId: initial.id, revision: 1 })
    ).toThrowError(
      expect.objectContaining({ code: "active_readers", status: 409 })
    );
    await expect(
      profiles.save(actor, {
        ...initial,
        database: { ...initial.database, password: { mode: "keep" } },
        expectedRevision: 1,
        name: "Reader guarded v2",
      })
    ).rejects.toMatchObject({ code: "active_readers", status: 409 });
    firstRead.release();

    await expect(
      profiles.save(actor, {
        ...initial,
        database: { ...initial.database, password: { mode: "keep" } },
        expectedRevision: 1,
        name: "Reader guarded v2",
      })
    ).resolves.toMatchObject({ revision: 2 });

    const secondRead = profiles.acquire(actor, {
      profileId: initial.id,
      revision: 2,
    });
    expect(() =>
      profiles.disable(actor, { profileId: initial.id, revision: 2 })
    ).toThrowError(
      expect.objectContaining({ code: "active_readers", status: 409 })
    );
    secondRead.release();
    expect(() =>
      profiles.disable(actor, { profileId: initial.id, revision: 2 })
    ).not.toThrow();
    expect(profiles.row(initial.id)?.enabled).toBe(0);
  });
});
