import { expect, type Page, type Route, test } from "@playwright/test";

const CUSTOM_MODULE_URL = /module=CUSTOM_MODULE/;
const actor = {
  email: "operator@example.test",
  id: "operator",
  name: "Operator",
};
const profile = {
  capabilities: ["read"],
  databaseLabel: "Stage DB",
  enabled: true,
  hasApi: false,
  id: "stage",
  name: "Staging",
  preset: "staging",
  revision: 4,
  safetyClass: "staging",
  updatedAt: "2026-11-14T00:00:00.000Z",
  writable: false,
};
const run = {
  actor,
  completedAt: "2026-11-14T00:00:01.280Z",
  createdAt: "2026-11-14T00:00:00.000Z",
  durationMs: 1280,
  errorCount: 1,
  featureKey: "shipment-import",
  id: "run-1",
  logCount: 2,
  module: "IMPORT_EXPORT",
  startedAt: "2026-11-14T00:00:00.000Z",
  status: "COMPLETED_WITH_ERRORS",
  summary: { failed: 1, imported: 2 },
  targetId: "batch-1",
  targetType: "ImportBatch",
  title: "Import shipment labels",
  warningCount: 0,
  workflowKey: "shipment.import",
};
const logs = [
  {
    createdAt: "2026-11-14T00:00:00.000Z",
    durationMs: 50,
    event: "parsed",
    id: "log-1",
    level: "INFO",
    message: "Loaded original rows",
    metadata: { count: 3, fileName: "shipment.csv" },
    operationName: "parseUpload",
    rowNumber: 0,
    sequence: 1,
    shopDomain: "fixture.myshopify.com",
    stage: "parse",
    status: "COMPLETED",
  },
  {
    createdAt: "2026-11-14T00:00:01.000Z",
    errorCode: "LABEL_NOT_FOUND",
    errorDetails: { row: 3 },
    errorMessage: "The selected label is unavailable",
    errorName: "InvalidLabel",
    event: "failed",
    id: "log-2",
    level: "ERROR",
    message: "Import row failed",
    rowNumber: 3,
    sequence: 2,
    stage: "import",
    status: "FAILED",
  },
];
const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({
    body: JSON.stringify(data),
    contentType: "application/json",
    status,
  });
async function setup(page: Page) {
  await page.route("**/api/identity", (route) => json(route, { user: actor }));
  await page.route("**/works/oms-management/api/profiles**", (route) =>
    json(route, { actor, profiles: [profile] })
  );
  await page.route("**/works/oms-management/api/diagnostics**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    let data: unknown;
    switch (params.get("resource")) {
      case "log-options":
        data = {
          featureKeys: ["shipment-import"],
          modules: ["CUSTOM_MODULE"],
          timeZone: "Asia/Hong_Kong",
        };
        break;
      case "log":
        data = {
          logs: params.get("after") === "1" ? [logs[1]] : [logs[0]],
          nextSequence: params.get("after") === "1" ? null : 1,
          run,
        };
        break;
      case "log-bundle":
        data = { run: { ...run, logs } };
        break;
      default:
        data = { next: null, rows: [run] };
    }
    return json(route, { data, target: { profileId: "stage", revision: 4 } });
  });
}

test("shows source workflow layout, module filters and incremental timeline", async ({
  page,
}) => {
  await setup(page);
  await page.goto(
    "/works/oms-management/debug-logs?profile=stage&module=IMPORT_EXPORT&run=run-1"
  );
  await expect(page.getByLabel("Module", { exact: true })).toContainText(
    "Import Export"
  );
  const detail = page.getByRole("region", { name: "Workflow detail" });
  await expect(
    detail.getByRole("heading", { name: "Import shipment labels" })
  ).toBeVisible();
  await expect(
    detail.getByText("operator@example.test", { exact: false })
  ).toBeVisible();
  await expect(detail.getByText("1.3s", { exact: true })).toBeVisible();
  await expect(detail.getByText("Row 0", { exact: true })).toBeVisible();
  await detail.getByText("Payload", { exact: true }).click();
  await expect(
    detail.locator("pre").filter({ hasText: "shipment.csv" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more log entries" }).click();
  await expect(
    detail.getByText("The selected label is unavailable")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more log entries" })
  ).toHaveCount(0);
  await page.getByLabel("Module", { exact: true }).click();
  await page
    .getByRole("option", { exact: true, name: "Custom Module" })
    .click();
  const filtered = page.waitForRequest(
    (request) =>
      request.url().includes("resource=logs") &&
      new URL(request.url()).searchParams.get("module") === "CUSTOM_MODULE"
  );
  await page.getByRole("button", { exact: true, name: "Search" }).click();
  await filtered;
  await expect(page).toHaveURL(CUSTOM_MODULE_URL);
  await page.getByRole("button", { exact: true, name: "Clear" }).click();
  await expect(page.getByLabel("Module", { exact: true })).toContainText(
    "All modules"
  );
});

test("copies all bundle logs and downloads the original import file", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          document.documentElement.dataset.copiedBundle = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.route("**/works/oms-management/api/import-file**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("profileId")).toBe("stage");
    expect(params.get("revision")).toBe("4");
    expect(params.get("id")).toBe("run-1");
    return route.fulfill({
      body: "sku,quantity\nfixture,1",
      contentType: "text/csv",
      headers: { "content-disposition": 'attachment; filename="shipment.csv"' },
    });
  });
  await page.goto("/works/oms-management/debug-logs?profile=stage");
  await page.getByRole("button", { name: "Copy Bundle" }).click();
  await expect(
    page.getByText("Debug bundle copied, including all log entries.")
  ).toBeVisible();
  const copied = await page.evaluate(() =>
    JSON.parse(document.documentElement.dataset.copiedBundle ?? "{}")
  );
  expect(copied.logs).toHaveLength(2);
  expect(copied.logs[1].errorCode).toBe("LABEL_NOT_FOUND");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Original" }).click();
  expect((await downloaded).suggestedFilename()).toBe("shipment.csv");
});

test("reports download failures without a fake successful download", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/works/oms-management/api/import-file**", (route) =>
    json(
      route,
      {
        error: {
          message: "Configure the OMS API to retrieve this stored file.",
        },
      },
      409
    )
  );
  await page.goto("/works/oms-management/debug-logs?profile=stage");
  await page.getByRole("button", { name: "Download Original" }).click();
  await expect(
    page.getByText("Configure the OMS API to retrieve this stored file.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download Original" })
  ).toBeEnabled();
});
