import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { databaseFingerprint } from "../../server/oms-api/client";
import type { Connection } from "../../server/profiles/schema";
import {
  directVersion,
  executeDirectSettings,
  previewDirectSettings,
  type SettingsInput,
} from "../../server/services/direct-settings";
import { decryptOmsSecret } from "../../server/services/oms-secrets";
import { omsPgTypes } from "../../server/target/clients";

const url = process.env.OMS_TEST_POSTGRES_URL;
if (!url) {
  throw new Error("OMS_TEST_POSTGRES_URL must point to disposable Postgres.");
}
const connection: Connection = {
  accountIds: ["account-1"],
  api: null,
  database: {
    host: "127.0.0.1",
    name: "postgres",
    password: "fixture",
    port: 5546,
    tls: false,
    user: "postgres",
  },
  globalDiagnostics: true,
};
it("writes direct settings and encrypted app CRUD, rejects stale versions and account mismatches", async () => {
  vi.stubEnv(
    "OMS_DIRECT_RESOURCES_JSON",
    JSON.stringify({
      [databaseFingerprint(connection)]: {
        encryptionKey: "test-only-oms-encryption",
      },
    })
  );
  const pool = new Pool({ connectionString: url, types: omsPgTypes });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL TIME ZONE 'Asia/Saigon'");
    await db.query(`CREATE TEMP TABLE site_setting(key text PRIMARY KEY,value text,"createdAt" timestamp(3),"updatedAt" timestamp(3));
    CREATE TEMP TABLE shopify_app(id text PRIMARY KEY,name text,"clientId" text UNIQUE,"clientSecretEncrypted" text,"installLink" text,"availableStoreDomains" text[],scopes text[],"apiVersion" text,status text,"createdAt" timestamp(3),"updatedAt" timestamp(3));
    CREATE TEMP TABLE shopify_store(id text PRIMARY KEY,"accountId" text,"webhookSignatureEncrypted" text,"updatedAt" timestamp(3));
    CREATE TEMP TABLE scheduled_job_config("jobKey" text PRIMARY KEY,enabled boolean,"cronExpression" text,"createdAt" timestamp(3),"updatedAt" timestamp(3));
    INSERT INTO shopify_store VALUES('store-1','account-1',NULL,'2030-01-01');`);
    const input: SettingsInput = {
      action: "shopify.settings.update",
      expectedVersion: null,
      payload: {
        shopifyApiVersion: "2026-04 ",
        shopifyRequiredScopes: "read_orders,write_orders",
        siteTimezone: "Asia/Hong_Kong",
      },
    };
    input.expectedVersion = directVersion(
      input.action,
      await previewDirectSettings(db, input)
    );
    await expect(
      executeDirectSettings(db, connection, input)
    ).resolves.toMatchObject({ shopifyApiVersion: "2026-04" });
    await expect(
      executeDirectSettings(db, connection, input)
    ).rejects.toMatchObject({ code: "version_conflict" });
    const appInput: SettingsInput = {
      action: "shopify.app.create",
      expectedVersion: null,
      payload: {
        clientId: "client",
        clientSecret: "secret",
        installLink: "https://admin.shopify.com/oauth/install?client_id=client",
        name: "Test",
        storeDomains: ["test.myshopify.com"],
      },
    };
    const created = (await executeDirectSettings(db, connection, appInput)) as {
      app: Record<string, unknown>;
    };
    expect(created.app.hasClientSecret).toBe(true);
    expect(created.app.clientSecretEncrypted).toBeUndefined();
    const appId = created.app.id;
    const [stored] = (
      await db.query(
        'SELECT "clientSecretEncrypted" FROM shopify_app WHERE id=$1',
        [appId]
      )
    ).rows;
    expect(decryptOmsSecret(connection, stored.clientSecretEncrypted)).toBe(
      "secret"
    );
    const update: SettingsInput = {
      ...appInput,
      action: "shopify.app.update",
      expectedVersion: (created.app.updatedAt as Date).toISOString(),
      payload: {
        ...appInput.payload,
        appId,
        clientSecret: "",
        name: "Updated",
      },
    };
    const updated = (await executeDirectSettings(db, connection, update)) as {
      app: Record<string, unknown>;
    };
    expect(updated.app.name).toBe("Updated");
    expect(
      (
        await db.query(
          'SELECT "clientSecretEncrypted" FROM shopify_app WHERE id=$1',
          [appId]
        )
      ).rows[0].clientSecretEncrypted
    ).toBe(stored.clientSecretEncrypted);
    await expect(
      executeDirectSettings(db, connection, update)
    ).rejects.toMatchObject({ code: "version_conflict" });
    await expect(
      executeDirectSettings(db, connection, {
        ...appInput,
        payload: {
          ...appInput.payload,
          clientId: "other",
          installLink:
            "https://admin.shopify.com/oauth/install?client_id=other",
        },
      })
    ).rejects.toMatchObject({ code: "invalid_settings" });
    const signature: SettingsInput = {
      accountId: "account-1",
      action: "shopify.signature.update",
      expectedVersion: "2030-01-01T00:00:00.000Z",
      payload: { signature: "signature", storeId: "store-1" },
    };
    await executeDirectSettings(db, connection, signature);
    expect(
      decryptOmsSecret(
        connection,
        (
          await db.query(
            'SELECT "webhookSignatureEncrypted" FROM shopify_store'
          )
        ).rows[0].webhookSignatureEncrypted
      )
    ).toBe("signature");
    await expect(
      executeDirectSettings(db, connection, {
        ...signature,
        accountId: "wrong",
      })
    ).rejects.toMatchObject({ code: "store_not_found" });
    const jobKey = "notifications.order-dispatch";
    const cron: SettingsInput = {
      action: "cron.stop",
      expectedVersion: null,
      payload: { jobKey },
    };
    const stopped = (await executeDirectSettings(db, connection, cron)) as {
      config: Record<string, unknown>;
    };
    expect(stopped.config.enabled).toBe(false);
    await expect(
      executeDirectSettings(db, connection, cron)
    ).rejects.toMatchObject({ code: "version_conflict" });
    await executeDirectSettings(db, connection, {
      action: "cron.update",
      expectedVersion: (stopped.config.updatedAt as Date).toISOString(),
      payload: { cronExpression: "0 9 * * *", enabled: true, jobKey },
    });
    const deletion: SettingsInput = {
      action: "shopify.app.delete",
      expectedVersion: (updated.app.updatedAt as Date).toISOString(),
      payload: { appId, clientId: "wrong" },
    };
    await expect(
      executeDirectSettings(db, connection, deletion)
    ).rejects.toMatchObject({ code: "invalid_settings" });
    await executeDirectSettings(db, connection, {
      ...deletion,
      payload: { appId, clientId: "client" },
    });
    expect(
      (await db.query("SELECT count(*)::int AS count FROM shopify_app")).rows[0]
        .count
    ).toBe(0);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
    vi.unstubAllEnvs();
  }
});
