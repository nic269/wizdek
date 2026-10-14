import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_SHOPIFY_ACCESS_TOKEN } from "./support/fake-shopify";
import {
  chooseOption,
  connectStoreWithToken,
  createOrganization,
  createTestSuffix,
  signUp,
} from "./support/user-flows";

const FIXTURE = resolve("tests/fixtures/orders-sample.csv");
const FAKE_SHOPIFY_URL = `http://127.0.0.1:${process.env.FAKE_SHOPIFY_PORT ?? "3999"}`;
const RUN_URL_PATTERN = /\/flows\/[a-z0-9]+\/runs\/[a-z0-9]+$/;
const RUN_FINISHED_PATTERN = /Partially failed|Succeeded|Failed/;
const ORDER_NAMES = [
  "#E2E-1001",
  "#E2E-1002",
  "#E2E-1003",
  "#E2E-1004",
  "#E2E-1005",
];

const node = (
  id: string,
  type: string,
  config: Record<string, unknown>,
  x: number
) => ({
  config,
  id,
  name: id,
  position: { x, y: 0 },
  type,
});

const edge = (source: string, target: string, sourceHandle = "main") => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

const CSV_FLOW = {
  edges: [
    edge("trigger", "parse"),
    edge("parse", "find"),
    edge("find", "check"),
    edge("check", "tag", "true"),
  ],
  nodes: [
    node(
      "trigger",
      "trigger.manual",
      { inputs: [{ key: "csvFile", label: "CSV file", type: "file" }] },
      0
    ),
    node("parse", "data.parseCsv", { file: "{{ $json.csvFile }}" }, 260),
    node(
      "find",
      "shopify.findOrder",
      { by: "name", value: "{{ $json.Order }}" },
      520
    ),
    node(
      "check",
      "logic.if",
      {
        conditions: [
          {
            left: "{{ $json.Total }}",
            operator: "gt",
            right: "1000",
            valueType: "number",
          },
        ],
      },
      780
    ),
    node(
      "tag",
      "shopify.addTags",
      { resourceId: "{{ $json.order.id }}", tags: ["high-value"] },
      1040
    ),
  ],
  schemaVersion: 1,
};

/** Creates the CSV tagging flow through the API the app itself uses. */
const seedFlow = async (page: Page, organizationName: string) => {
  const organizations = await page.request.get("/api/organizations");
  const organization = (
    (await organizations.json()) as { data: { id: string; name: string }[] }
  ).data.find(({ name }) => name === organizationName);
  const created = await page.request.post(
    `/api/organizations/${organization?.id}/flows`,
    { data: { name: "Tag high-value orders" } }
  );
  expect(created.status()).toBe(201);
  const flowId = ((await created.json()) as { data: { flow: { id: string } } })
    .data.flow.id;
  const saved = await page.request.post(`/api/flows/${flowId}/versions`, {
    data: { baseVersion: 1, definition: CSV_FLOW },
  });
  expect(saved.status()).toBe(201);
  return flowId;
};

// The run trace is the builder canvas, which is a desktop surface.
test.skip(({ isMobile }) => isMobile, "The flow builder is a desktop tool.");

test("a member runs the CSV flow and reads the failed row in the trace", async ({
  page,
  request,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  const organizationName = `Run Studio ${suffix}`;
  const seeded = await request.post(`${FAKE_SHOPIFY_URL}/__control/orders`, {
    data: ORDER_NAMES.map((name) => ({
      id: `gid://shopify/Order/${name.slice(1)}`,
      name,
      tags: [],
      totalPrice: "0",
    })),
  });
  expect(seeded.ok()).toBe(true);

  await signUp({
    email: `flow-runner-${suffix}@example.com`,
    name: "Flow Runner",
    page,
  });
  await createOrganization({ name: organizationName, page });
  await connectStoreWithToken({
    accessToken: E2E_SHOPIFY_ACCESS_TOKEN,
    page,
    shopDomain: `run-${suffix}.myshopify.com`.toLowerCase(),
  });
  const flowId = await seedFlow(page, organizationName);

  await page.goto(`/flows/${flowId}`);
  await page.getByRole("button", { exact: true, name: "Run" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Store to run against")).toContainText(
    "Fake Store"
  );
  await dialog.getByLabel("CSV file").setInputFiles(FIXTURE);
  await dialog.getByRole("button", { name: "Start run" }).click();

  // The trace follows the run until it reaches a final status.
  await expect(page).toHaveURL(RUN_URL_PATTERN);
  await expect(page.getByTestId("run-status")).toHaveText(
    RUN_FINISHED_PATTERN,
    {
      timeout: 60_000,
    }
  );
  await expect(page.getByTestId("run-status")).toHaveText("Partially failed");
  await expect(page.getByTestId("flow-node-parse")).toContainText(
    "1 in · 1 ok"
  );
  await expect(page.getByTestId("flow-node-find")).toContainText(
    "6 in · 5 ok · 1 failed"
  );
  await expect(page.getByTestId("flow-node-check")).toContainText(
    "5 in · 5 ok"
  );
  await expect(page.getByTestId("flow-node-tag")).toContainText("3 in · 3 ok");

  // The failed row explains itself, and shows the row it came from.
  await page.getByTestId("flow-node-find").click();
  const items = page.getByTestId("run-items-panel");
  await chooseOption(page, items.getByLabel("Item status filter"), "Failed");
  await expect(items.getByRole("listitem")).toHaveCount(1);
  await expect(items).toContainText('No order found for "#E2E-MISSING".');
  await items.getByText("Input", { exact: true }).click();
  await expect(items).toContainText('"$row": 5');

  await chooseOption(page, items.getByLabel("Item status filter"), "Succeeded");
  await expect(items.getByRole("listitem")).toHaveCount(5);

  // The run is listed for the flow with its outcome.
  await page.goto(`/flows/${flowId}/runs`);
  const row = page.getByRole("row").filter({ hasText: "Partially failed" });
  await expect(row).toContainText("Fake Store");
  await expect(row).toContainText("Flow Runner");
  await expect(row).toContainText("failed");
});
