import { expect, type Page, type Route, test } from "@playwright/test";

const PRODUCTION_URL =
  /\/works\/oms-management\/debug-logs\?profile=production$/;
const STAGE_SETTINGS_URL =
  /\/works\/oms-management\/settings\/site-config\?profile=stage$/;
const DB_PASSWORD_LABEL = /^DB password/;

const actor = {
  email: "operator@example.test",
  id: "operator-1",
  name: "OMS Operator",
};
const profiles = [
  {
    capabilities: [
      "read",
      "profiles:edit",
      "settings:write",
      "commands",
      "secrets:reveal",
    ],
    databaseLabel: "Staging database",
    enabled: true,
    hasApi: true,
    id: "stage",
    name: "Staging",
    preset: "staging",
    revision: 4,
    safetyClass: "staging",
    updatedAt: "2026-11-14T00:00:00.000Z",
    writable: true,
  },
  {
    capabilities: [
      "read",
      "profiles:edit",
      "settings:write",
      "commands",
      "secrets:reveal",
    ],
    databaseLabel: "Production database",
    enabled: true,
    hasApi: true,
    id: "production",
    name: "Production",
    preset: "production",
    revision: 9,
    safetyClass: "production",
    updatedAt: "2026-11-14T00:00:00.000Z",
    writable: true,
  },
] as const;

const diagnosticsResponse = (
  profileId: "stage" | "production",
  resource = "logs"
) => ({
  data: {
    ...(resource === "log"
      ? {
          logs: [],
          nextSequence: null,
          run: {
            actor: null,
            createdAt: "2026-11-14T00:00:00.000Z",
            errorCount: 1,
            featureKey: "fixture",
            id: "shared-workflow-id",
            logCount: 1,
            module: "IMPORT_EXPORT",
            startedAt: "2026-11-14T00:00:00.000Z",
            status: "FAILED",
            summary: {},
            title: profileId === "stage" ? "STAGE DATA" : "PRODUCTION DATA",
            warningCount: 0,
            workflowKey: "fixture.run",
          },
        }
      : {}),
    ...(resource === "maintenance"
      ? {
          value: { enabled: false, exceptions: [] },
          version: "2026-11-14T00:00:00.000Z",
        }
      : {
          modules: ["IMPORT_EXPORT"],
          next: null,
          rows: [
            {
              actor: null,
              createdAt: "2026-11-14T00:00:00.000Z",
              errorCount: 1,
              featureKey: "fixture",
              id: "shared-workflow-id",
              logCount: 1,
              logs: [],
              module: "IMPORT_EXPORT",
              startedAt: "2026-11-14T00:00:00.000Z",
              status: "FAILED",
              title: profileId === "stage" ? "STAGE DATA" : "PRODUCTION DATA",
              warningCount: 0,
              workflowKey: "fixture.run",
            },
          ],
        }),
    ...(resource === "overview"
      ? {
          api: "not-configured",
          compatibility: {
            checkedAt: "2026-11-14T00:00:00.000Z",
            features: ["health", "logs"],
          },
          failures: {
            rows: [
              {
                id: "shared-workflow-id",
                status: "FAILED",
                title: profileId === "stage" ? "STAGE DATA" : "PRODUCTION DATA",
              },
            ],
          },
        }
      : {}),
    refreshedAt: "2026-11-14T00:00:00.000Z",
  },
  target: {
    profileId,
    revision: profileId === "stage" ? 4 : 9,
  },
});

async function selectEnvironment(page: Page, name: "Production" | "Staging") {
  await page.getByLabel("Environment").click();
  await page.getByRole("option", { exact: true, name }).click();
}

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  });

async function mockApplication(
  page: Page,
  diagnostics?: (route: Route) => Promise<void>
) {
  await page.route("**/api/identity", (route) =>
    fulfillJson(route, { expiresAt: "2026-11-14T12:00:00.000Z", user: actor })
  );
  await page.route("**/works/oms-management/api/profiles**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("id")) {
      return fulfillJson(route, {
        accountIds: ["account-1"],
        api: {
          databaseIdentity: "database-1",
          deploymentId: "deployment-1",
          origin: "https://oms-api.example.test",
        },
        database: {
          host: "masked-stage-db",
          name: "oms",
          port: 5432,
          tls: true,
          user: "restricted",
        },
        globalDiagnostics: false,
        presetChanged: false,
      });
    }
    return fulfillJson(route, { actor, profiles });
  });
  await page.route(
    "**/works/oms-management/api/diagnostics**",
    async (route) => {
      if (diagnostics) {
        return diagnostics(route);
      }
      const profileId = new URL(route.request().url()).searchParams.get(
        "profileId"
      ) as "stage" | "production";
      const resource =
        new URL(route.request().url()).searchParams.get("resource") ?? "logs";
      await fulfillJson(route, diagnosticsResponse(profileId, resource));
    }
  );
  await page.route("**/works/oms-management/api/site-config**", (route) => {
    const profileId = new URL(route.request().url()).searchParams.get(
      "profileId"
    ) as "stage" | "production";
    return fulfillJson(route, {
      data: {
        apps: [],
        appsAvailable: true,
        cron: { configs: [], note: "Fixture cron state", runs: [] },
        maintenance: {
          value: { enabled: false, exceptions: [] },
          version: "2026-11-14T00:00:00.000Z",
        },
        settings: {
          shopifyApiVersion: "2026-01",
          shopifyRequiredScopes: "read_orders",
          siteTimezone: "Asia/Ho_Chi_Minh",
        },
        settingsVersion: "fixture-settings-version",
      },
      target: { profileId, revision: profileId === "stage" ? 4 : 9 },
    });
  });
  await page.route("**/works/oms-management/api/operations**", (route) =>
    fulfillJson(route, { operations: [] })
  );
  await page.route("**/works/oms-management/api/bridge**", (route) =>
    fulfillJson(route, { ok: true })
  );
}

test("adds a database-wide connection without an OMS account ID", async ({
  page,
}) => {
  await mockApplication(page);
  let submitted:
    | {
        action: string;
        data: { name: string; url: string; environment: string };
      }
    | undefined;
  await page.route("**/works/oms-management/api/profiles", (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    submitted = route.request().postDataJSON();
    return fulfillJson(route, { profile: profiles[0] });
  });
  await page.goto("/works/oms-management");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.getByLabel("Name", { exact: true }).fill("OMS Staging");
  const url =
    "postgresql://operator:fixture-password@stage-db.example.test/oms_staging";
  await page.getByLabel("Database URL", { exact: true }).fill(url);
  await expect(page.getByLabel("OMS account IDs", { exact: true })).toHaveCount(
    0
  );
  await page.getByRole("button", { name: "Test & save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(submitted).toEqual({
    action: "save-url",
    data: { environment: "staging", name: "OMS Staging", url },
  });
});

test("adds an API connection using only its URL and service token", async ({
  page,
}) => {
  await mockApplication(page);
  let submitted: { action: string; data: Record<string, unknown> } | undefined;
  await page.route("**/works/oms-management/api/profiles", (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    submitted = route.request().postDataJSON();
    return fulfillJson(route, { profile: profiles[0] });
  });
  await page.goto("/works/oms-management");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.getByLabel("Name", { exact: true }).fill("OMS Staging");
  const url =
    "postgresql://operator:fixture-password@stage-db.example.test/oms_staging";
  await page.getByLabel("Database URL", { exact: true }).fill(url);
  await page.getByText("Optional OMS API connection", { exact: true }).click();
  await page
    .getByLabel("API URL", { exact: true })
    .fill("https://stage-api.example.test");
  const token = "fixture-service-token-".repeat(2);
  await page.getByLabel("Service token", { exact: true }).fill(token);
  await expect(page.getByLabel("Deployment ID", { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByLabel("Database identity", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Test & save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(submitted).toEqual({
    action: "save-url",
    data: {
      api: { origin: "https://stage-api.example.test", token },
      environment: "staging",
      name: "OMS Staging",
      url,
    },
  });
});

test("requires a token when an API URL is supplied", async ({ page }) => {
  await mockApplication(page);
  let saved = false;
  await page.route("**/works/oms-management/api/profiles", (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    saved = true;
    return fulfillJson(route, { profile: profiles[0] });
  });
  await page.goto("/works/oms-management");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.getByLabel("Name", { exact: true }).fill("OMS Staging");
  await page
    .getByLabel("Database URL", { exact: true })
    .fill("postgresql://user:fixture@stage.example.test/oms");
  await page.getByText("Optional OMS API connection", { exact: true }).click();
  await page
    .getByLabel("API URL", { exact: true })
    .fill("https://stage-api.example.test");
  await page.getByRole("button", { name: "Test & save" }).click();
  await expect(
    page.getByText(
      "Enter both the API URL and service token, or leave both empty."
    )
  ).toBeVisible();
  expect(saved).toBe(false);
});

test("editing a legacy API connection keeps its token without manual IDs", async ({
  page,
}) => {
  await mockApplication(page);
  let submitted: { data: { api: unknown } } | undefined;
  await page.route("**/works/oms-management/api/profiles", (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    submitted = route.request().postDataJSON();
    return fulfillJson(route, { profile: profiles[0] });
  });
  await page.goto("/works/oms-management/settings/site-config?profile=stage");
  await page.getByRole("button", { name: "Connection settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit connection" });
  await dialog.getByText("Optional OMS API connection").click();
  await expect(dialog.getByLabel("API URL", { exact: true })).toHaveValue(
    "https://oms-api.example.test"
  );
  await expect(dialog.getByLabel("Deployment ID", { exact: true })).toHaveCount(
    0
  );
  await expect(
    dialog.getByLabel("Database identity", { exact: true })
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Service token")).toHaveValue("");
  await dialog.getByRole("button", { name: "Validate & save" }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted?.data.api).toEqual({
    origin: "https://oms-api.example.test",
    token: { mode: "keep" },
  });
});

test("changing an API URL requires a replacement token", async ({ page }) => {
  await mockApplication(page);
  let saved = false;
  await page.route("**/works/oms-management/api/profiles", (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    saved = true;
    return fulfillJson(route, { profile: profiles[0] });
  });
  await page.goto("/works/oms-management/settings/site-config?profile=stage");
  await page.getByRole("button", { name: "Connection settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit connection" });
  await dialog.getByText("Optional OMS API connection").click();
  await dialog
    .getByLabel("API URL", { exact: true })
    .fill("https://another-api.example.test");
  await dialog.getByRole("button", { name: "Validate & save" }).click();
  await expect(
    dialog.getByText("Enter a new service token when changing the API URL.")
  ).toBeVisible();
  expect(saved).toBe(false);
});

test("selects an OMS account by name and email after connecting", async ({
  page,
}) => {
  await mockApplication(page);
  await page.route("**/works/oms-management/api/diagnostics**", (route) => {
    if (
      new URL(route.request().url()).searchParams.get("resource") !== "accounts"
    ) {
      return route.fallback();
    }
    return fulfillJson(route, {
      data: {
        rows: [
          {
            id: "account-1",
            name: "Evisu HK",
            users: [{ email: "operator@example.test", name: "Operator" }],
          },
        ],
      },
    });
  });
  await page.route("**/works/oms-management/api/bridge**", (route) =>
    fulfillJson(route, {
      data: { jobs: [], shopify: { apps: [], settings: [], stores: [] } },
    })
  );
  await page.goto(
    "/works/oms-management/settings/site-config/tools?profile=stage"
  );
  await page.getByRole("tab", { name: "Fraud review" }).click();
  await page.getByLabel("OMS account", { exact: true }).click();
  await page
    .getByRole("option", {
      exact: true,
      name: "Evisu HK · operator@example.test",
    })
    .click();
  await expect(page.getByLabel("OMS account", { exact: true })).toContainText(
    "Evisu HK"
  );
  await expect(
    page.getByRole("textbox", { name: "OMS account ID" })
  ).toHaveCount(0);
});

test("keeps same-ID data isolated while switching from staging to production", async ({
  page,
}) => {
  await mockApplication(page);
  await page.goto("/works/oms-management/debug-logs?profile=stage");

  await expect(
    page.getByRole("button", { exact: true, name: "Open workflow STAGE DATA" })
  ).toBeVisible();
  await selectEnvironment(page, "Production");

  await expect(page).toHaveURL(PRODUCTION_URL);
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Open workflow PRODUCTION DATA",
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Open workflow STAGE DATA" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Open workflow PRODUCTION DATA",
    })
  ).toHaveCount(1);
});

test("does not render a delayed staging read after switching to production", async ({
  page,
}) => {
  let releaseStaging: (() => void) | undefined;
  let markStagingFulfilled: (() => void) | undefined;
  const stagingRelease = new Promise<void>((resolve) => {
    releaseStaging = resolve;
  });
  const stagingFulfilled = new Promise<void>((resolve) => {
    markStagingFulfilled = resolve;
  });
  await mockApplication(page, async (route) => {
    const profileId = new URL(route.request().url()).searchParams.get(
      "profileId"
    ) as "stage" | "production";
    if (profileId === "stage") {
      await stagingRelease;
    }
    try {
      await fulfillJson(
        route,
        diagnosticsResponse(
          profileId,
          new URL(route.request().url()).searchParams.get("resource") ?? "logs"
        )
      );
    } finally {
      if (profileId === "stage") {
        markStagingFulfilled?.();
      }
    }
  });
  await page.goto("/works/oms-management/debug-logs?profile=stage");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading Staging…" })
  ).toBeVisible();

  await selectEnvironment(page, "Production");
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Open workflow PRODUCTION DATA",
    })
  ).toBeVisible();
  releaseStaging?.();
  await stagingFulfilled;

  await expect(
    page.getByRole("button", { exact: true, name: "Open workflow STAGE DATA" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      exact: true,
      name: "Open workflow PRODUCTION DATA",
    })
  ).toBeVisible();
});

test("clears environment data when identity renewal returns 401", async ({
  page,
}) => {
  let identityExpired = false;
  await mockApplication(page);
  await page.unroute("**/api/identity");
  await page.route("**/api/identity", (route) => {
    if (!identityExpired) {
      return fulfillJson(route, {
        expiresAt: "2026-11-14T12:00:00.000Z",
        user: actor,
      });
    }
    return fulfillJson(route, { error: { message: "unauthorized" } }, 401);
  });
  await page.goto("/works/oms-management/debug-logs?profile=stage");
  await expect(
    page.getByRole("button", { exact: true, name: "Open workflow STAGE DATA" })
  ).toBeVisible();

  identityExpired = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(
    page.getByRole("heading", { name: "Sign in to continue" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Open workflow STAGE DATA" })
  ).toHaveCount(0);
});

test("shows an explicit production banner", async ({ page }) => {
  await mockApplication(page);
  await page.goto("/works/oms-management/debug-logs?profile=production");

  const banner = page.locator('[role="status"]', {
    hasText: "Production environment.",
  });
  await expect(banner).toContainText("Production environment");
  await expect(banner).toContainText(
    "All data and operations belong to production."
  );
});

test("opens profile editing with secret fields masked and empty", async ({
  page,
}) => {
  await mockApplication(page);
  await page.goto("/works/oms-management/settings/site-config?profile=stage");
  await page.getByRole("button", { name: "Connection settings" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit connection" });
  const password = dialog.getByLabel(DB_PASSWORD_LABEL);
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("");
  await expect(
    dialog.getByText("Leave empty to keep the current password")
  ).toBeVisible();
  await dialog.getByText("Optional OMS API connection").click();
  const serviceToken = dialog.getByLabel("Service token");
  await expect(serviceToken).toHaveAttribute("type", "password");
  await expect(serviceToken).toHaveValue("");
});

test("keeps unsaved editing state when an environment switch is cancelled", async ({
  page,
}) => {
  await mockApplication(page);
  await page.goto("/works/oms-management/settings/site-config?profile=stage");
  const paths = page.getByLabel("Page exceptions");
  await paths.fill("/unsaved-stage-path");
  page.once("dialog", (confirmation) => confirmation.dismiss());

  await selectEnvironment(page, "Production");

  await expect(page).toHaveURL(STAGE_SETTINGS_URL);
  await expect(page.getByLabel("Environment")).toContainText("Staging");
  await expect(paths).toHaveValue("/unsaved-stage-path");
});
