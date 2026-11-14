import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../server/profiles/schema";
import {
  cronCatalog,
  cronWithCatalog,
} from "../../server/services/cron-catalog";
import {
  directCatalog,
  directReveal,
} from "../../server/services/direct-reads";

vi.mock("../../server/services/oms-secrets", () => ({
  decryptOmsSecret: (_connection: unknown, value: string) =>
    `decrypted:${value}`,
}));
vi.mock("../../server/oms-api/client", () => ({
  bridgeRequest: () => {
    throw new Error("Direct reads must not call OMS API");
  },
  verifyBinding: () => {
    throw new Error("Direct reads must not call OMS API");
  },
}));
const connection = {
  accountIds: [],
  api: null,
  globalDiagnostics: true,
} as unknown as Connection;
function database() {
  return {
    query: vi.fn((sql: string) => {
      if (sql.includes("FROM scheduled_job_config")) {
        return {
          rows: [
            {
              cronExpression: "0 1 * * *",
              enabled: false,
              jobKey: "sales-data.update",
            },
          ],
        };
      }
      if (sql.includes("FROM scheduled_job_run")) {
        return { rows: [] };
      }
      if (sql.includes("WHERE key='siteTimezone'")) {
        return { rows: [{ value: "Asia/Hong_Kong" }] };
      }
      if (sql.includes("FROM shopify_app")) {
        return { rows: [{ hasClientSecret: true, id: "app" }] };
      }
      if (sql.includes("FROM shopify_store")) {
        return {
          rows: [
            {
              accountId: "account",
              id: "store",
              webhookSignatureEncrypted: "signature",
            },
          ],
        };
      }
      if (sql.includes("FROM shopify_token")) {
        return { rows: [{ accessTokenEncrypted: "token" }] };
      }
      return { rows: [] };
    }),
  };
}

describe("direct settings reads without OMS API", () => {
  it("loads all five cron definitions with stored overrides and computes the next run", async () => {
    const result = await cronWithCatalog(
      database() as unknown as PoolClient,
      connection
    );
    expect(result.catalog).toHaveLength(5);
    expect(
      result.catalog.find((job) => job.key === "sales-data.update")
    ).toMatchObject({ enabled: false, nextRunAt: null });
    expect(
      result.catalog.find((job) => job.key === "notifications.order-dispatch")
        ?.nextRunAt
    ).toBeTruthy();
    const jobs = cronCatalog(
      [],
      "Asia/Hong_Kong",
      new Date("2026-11-14T00:00:00Z")
    );
    expect(jobs.find((job) => job.key === "sales-data.update")?.nextRunAt).toBe(
      "2026-11-14T17:00:00.000Z"
    );
  });
  it("keeps invalid cron expressions visible without breaking catalog", () => {
    expect(
      cronCatalog(
        [{ cronExpression: "bad", jobKey: "sales-data.update" }],
        "UTC"
      )[0]
    ).toMatchObject({ cronExpression: "bad", nextRunAt: null });
  });
  it("reads catalog and store credentials directly and scopes SQL to requested account", async () => {
    const db = database();
    expect(
      (await directCatalog(db as unknown as PoolClient, connection)).shopify
        .apps
    ).toEqual([{ hasClientSecret: true, id: "app" }]);
    expect(
      await directReveal(
        db as unknown as PoolClient,
        connection,
        "shopify.token.reveal",
        "account",
        { storeId: "store" }
      )
    ).toEqual({ secret: "decrypted:token" });
    expect(
      await directReveal(
        db as unknown as PoolClient,
        connection,
        "shopify.signature.reveal",
        "account",
        { storeId: "store" }
      )
    ).toEqual({ secret: "decrypted:signature" });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id=$1 AND "accountId"=$2'),
      ["store", "account"]
    );
  });
  it("rejects accounts outside the connection scope before reading secrets", async () => {
    const db = database();
    await expect(
      directReveal(
        db as unknown as PoolClient,
        { ...connection, accountIds: ["allowed"], globalDiagnostics: false },
        "shopify.token.reveal",
        "other",
        { storeId: "store" }
      )
    ).rejects.toMatchObject({ code: "account_denied" });
    expect(db.query).not.toHaveBeenCalled();
  });
});
