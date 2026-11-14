import { expect, type Page, test } from "@playwright/test";

const CRON_LOG_HREF = /profile=stage.*featureKey=scheduled-job/;

async function setup(page: Page, writable = true, hasApi = writable) {
  const actor = {
    email: "operator@example.test",
    id: "operator",
    name: "Operator",
  };
  const profiles = ["stage", "production"].map((id) => ({
    capabilities: ["read", "settings:write", "commands"],
    databaseLabel: `${id} database`,
    enabled: true,
    hasApi,
    id,
    name: id === "stage" ? "Staging" : "Production",
    revision: 1,
    safetyClass: id === "stage" ? "staging" : "production",
    writable,
  }));
  await page.route("**/api/identity", (route) =>
    route.fulfill({ json: { user: actor } })
  );
  await page.route("**/works/oms-management/api/profiles**", (route) =>
    route.fulfill({ json: { actor, profiles } })
  );
  await page.route("**/works/oms-management/api/operations**", (route) =>
    route.fulfill({ json: { operations: [] } })
  );
  await page.route("**/works/oms-management/api/site-config**", (route) =>
    route.fulfill({
      json: {
        data: {
          apps: [
            {
              apiVersion: "2026-04",
              availableStoreDomains: ["fixture.myshopify.com"],
              clientId: "fixture-client-id",
              hasClientSecret: true,
              id: "app-1",
              installLink: "https://example.test/install",
              name: "OMS custom app",
              scopes: ["read_orders"],
              status: "ACTIVE",
              updatedAt: "2026-11-14T00:00:00Z",
            },
          ],
          appsAvailable: true,
          cron: {
            configs: [
              {
                consecutiveFailures: 2,
                cronExpression: "*/5 * * * *",
                enabled: true,
                jobKey: "order-sync",
                updatedAt: "2026-11-14T00:00:00Z",
              },
            ],
            note: "Stored state",
            runs: [
              {
                errorMessage: "Fixture provider unavailable",
                jobKey: "order-sync",
                startedAt: "2026-11-14T00:00:00Z",
                status: "FAILED",
              },
            ],
            timeZone: "Asia/Hong_Kong",
          },
          maintenance: {
            value: { enabled: false, exceptions: ["/orders"] },
            version: "maintenance-v1",
          },
          settings: {
            shopifyApiVersion: "2026-04",
            shopifyRequiredScopes: "read_orders,write_orders",
            siteTimezone: "Asia/Hong_Kong",
          },
          settingsVersion: "settings-v1",
        },
        target: {
          profileId: new URL(route.request().url()).searchParams.get(
            "profileId"
          ),
          revision: 1,
        },
      },
    })
  );
  await page.goto("/works/oms-management/settings/site-config?profile=stage");
}

test("renders all Site config panels using only a database connection", async ({
  page,
}) => {
  await setup(page, false);
  await expect(
    page.getByText("Maintenance mode", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Site general configurations", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByLabel("Shopify API version", { exact: true })
  ).toHaveValue("2026-04");
  await expect(page.getByLabel("Site timezone", { exact: true })).toContainText(
    "Hong Kong"
  );
  await expect(
    page.getByRole("button", { name: "Edit OMS custom app" })
  ).toBeVisible();
  await expect(page.getByText("Fixture provider unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run immediately" })
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "View Debug Logs" })
  ).toHaveAttribute("href", CRON_LOG_HREF);
});

test("keeps stored custom-app secrets absent and requires exact deletion confirmation", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit OMS custom app" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Custom App" });
  await expect(edit.getByLabel("Client secret", { exact: true })).toHaveValue(
    ""
  );
  await expect(
    edit.getByLabel("Client secret", { exact: true })
  ).toHaveAttribute("type", "password");
  await expect(edit.getByLabel("Available for stores")).toHaveValue(
    "fixture.myshopify.com"
  );
  await edit.getByRole("button", { exact: true, name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete OMS custom app" }).click();
  const deletion = page.getByRole("dialog", { name: "Delete custom app?" });
  const remove = deletion.getByRole("button", {
    exact: true,
    name: "Delete App",
  });
  await expect(remove).toBeDisabled();
  await deletion.getByLabel("Confirm client ID").fill("wrong-client-id");
  await expect(remove).toBeDisabled();
  await deletion.getByLabel("Confirm client ID").fill("fixture-client-id");
  await expect(remove).toBeEnabled();
});

test("preserves a general-settings draft when environment switching is cancelled", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByLabel("Shopify required scopes", { exact: true })
    .fill("read_orders,read_products");
  await expect(
    page.getByRole("button", { name: "Refresh OMS data" })
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Environment", { exact: true }).click();
  await page.getByRole("option", { exact: true, name: "Production" }).click();
  await expect(page.getByLabel("Environment", { exact: true })).toContainText(
    "Staging"
  );
  await expect(
    page.getByLabel("Shopify required scopes", { exact: true })
  ).toHaveValue("read_orders,read_products");
});

test("allows direct database settings with no API while keeping execution disabled", async ({
  page,
}) => {
  await setup(page, true, false);
  await expect(
    page.getByRole("button", { name: "Save maintenance settings" })
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Edit OMS custom app" })
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { exact: true, name: "Stop" })
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Run immediately" })
  ).toBeDisabled();
  await page
    .getByLabel("Shopify required scopes", { exact: true })
    .fill("read_orders");
  await expect(
    page.getByRole("button", { exact: true, name: "Save Settings" })
  ).toBeEnabled();
});

test("offers original imports without unused DHL document actions", async ({
  page,
}) => {
  await setup(page, true, false);
  await page.route("**/works/oms-management/api/bridge**", (route) =>
    route.fulfill({
      json: {
        data: { jobs: [], shopify: { apps: [], settings: [], stores: [] } },
      },
    })
  );
  await page.route("**/works/oms-management/api/accounts**", (route) =>
    route.fulfill({ json: { data: { rows: [] } } })
  );
  await page.goto(
    "/works/oms-management/settings/site-config/tools?profile=stage"
  );
  await page.getByRole("tab", { exact: true, name: "Original files" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "Download original" })
  ).toBeVisible();
  await expect(
    page.getByLabel("Workflow run ID", { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Document type", { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByText("DHL waybill", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Get shipment documents", { exact: true })
  ).toHaveCount(0);
});
