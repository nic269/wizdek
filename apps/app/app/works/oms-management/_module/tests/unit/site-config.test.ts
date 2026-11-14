import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatSiteDate, mergeCronJobs } from "../../lib/site-config";
import type { Config } from "../../server/config";
import type { Connection } from "../../server/profiles/schema";
import { siteConfig } from "../../server/services/site-config";

const mocks = vi.hoisted(() => ({
  cron: vi.fn(),
  maintenance: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("../../server/target/compatibility", () => ({ probe: mocks.probe }));
vi.mock("../../server/services/diagnostics", () => ({
  maintenance: mocks.maintenance,
}));
vi.mock("../../server/services/cron-catalog", () => ({
  cronWithCatalog: mocks.cron,
}));

beforeEach(() => vi.resetAllMocks());

describe("site config database reads", () => {
  it("requires database-wide scope before accessing settings", async () => {
    const query = vi.fn();
    await expect(
      siteConfig(
        { query } as unknown as PoolClient,
        { globalDiagnostics: false } as Connection,
        {} as Config
      )
    ).rejects.toMatchObject({ code: "global_scope_required" });
    expect(query).not.toHaveBeenCalled();
  });
  it("loads direct DB settings, masks credentials and uses per-job latest runs", async () => {
    mocks.probe.mockResolvedValue({ features: ["maintenance", "cron"] });
    mocks.maintenance.mockResolvedValue({
      value: { enabled: false, exceptions: [] },
      version: null,
    });
    mocks.cron.mockResolvedValue({
      configs: [{ jobKey: "busy" }, { jobKey: "quiet" }],
      note: "Stored state",
      runs: Array.from({ length: 100 }, () => ({ jobKey: "busy" })),
    });
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT key,value")) {
        return {
          rows: [
            {
              key: "siteTimezone",
              updatedAt: new Date("2026-11-14T00:00:00Z"),
              value: "Asia/Ho_Chi_Minh",
            },
          ],
        };
      }
      if (sql.includes("pg_class")) {
        return {
          rows: [
            "id",
            "name",
            "clientId",
            "installLink",
            "availableStoreDomains",
            "scopes",
            "apiVersion",
            "status",
            "clientSecretEncrypted",
            "updatedAt",
          ].map((attname) => ({ attname })),
        };
      }
      if (sql.includes("FROM shopify_app")) {
        return { rows: [{ hasClientSecret: true, id: "app" }] };
      }
      if (sql.includes("DISTINCT ON")) {
        return {
          rows: [
            { jobKey: "busy", status: "COMPLETED" },
            { jobKey: "quiet", status: "FAILED" },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await siteConfig(
      { query } as unknown as PoolClient,
      { globalDiagnostics: true } as Connection,
      {} as Config
    );
    expect(result.settings.siteTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(result.settingsVersion).toHaveLength(64);
    expect(result.apps).toEqual([{ hasClientSecret: true, id: "app" }]);
    const appSql = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM shopify_app")
    )?.[0];
    expect(appSql).toContain(
      'COALESCE(length("clientSecretEncrypted")>0,false)'
    );
    expect(appSql).not.toContain("SELECT *");
    expect(result.cron).not.toBeNull();
    if (result.cron) {
      expect(
        mergeCronJobs(result.cron).find((job) => job.jobKey === "quiet")
          ?.lastRun
      ).toMatchObject({ status: "FAILED" });
    }
  });
  it("does not query unreadable custom-app fields", async () => {
    mocks.probe.mockResolvedValue({ features: ["logs"] });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await siteConfig(
      { query } as unknown as PoolClient,
      { globalDiagnostics: true } as Connection,
      {} as Config
    );
    expect(result.appsAvailable).toBe(false);
    expect(result.apps).toEqual([]);
    expect(result.maintenance).toBeNull();
    expect(result.cron).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

it("merges runtime definitions with stored schedules and handles invalid legacy dates", () => {
  const jobs = mergeCronJobs({
    catalog: [
      {
        cronExpression: "* * * * *",
        enabled: true,
        key: "job",
        title: "Scheduled job",
      },
    ],
    configs: [
      { cronExpression: "0 9 * * *", enabled: false, jobKey: "job" },
      { jobKey: "legacy" },
    ],
    note: "",
    runs: [],
  });
  expect(jobs[0]).toMatchObject({
    cronExpression: "0 9 * * *",
    enabled: false,
    title: "Scheduled job",
  });
  expect(jobs[1]).toMatchObject({ jobKey: "legacy", lastRun: null });
  expect(formatSiteDate("invalid", "UTC")).toBe("Unavailable");
  expect(formatSiteDate(null, "UTC")).toBe("Never");
});
