import { expect, type Page, test } from "@playwright/test";
import { prisma } from "../../packages/database/src/client";
import {
  chooseOption,
  createOrganization,
  createTestSuffix,
  signUp,
} from "./support/user-flows";

const BUILDER_URL_PATTERN = /\/flows\/[a-z0-9]+$/;
const ISSUE_FOOTER_PATTERN = /required|Choose|Add at least/;
const PALETTE_ENTRIES = [
  "Manual trigger",
  "Parse CSV",
  "Find order",
  "If",
  "Add tags",
];

const nodes = (page: Page) => page.locator("[data-testid^=flow-node-]");
const edges = (page: Page) => page.locator(".react-flow__edge");

const createFlow = async (page: Page, name: string) => {
  await page.goto("/flows");
  await page.getByLabel("Flow name").fill(name);
  await page.getByRole("button", { name: "Create flow" }).click();
  await expect(page).toHaveURL(BUILDER_URL_PATTERN);
  await expect(page.getByLabel("Node palette")).toBeVisible();
};

const addFromPalette = (page: Page, label: string) =>
  page
    .getByLabel("Node palette")
    .getByRole("button", { exact: true, name: `Add ${label}` })
    .click();

/** Connects two steps the way a keyboard or touch user does: handle, then handle. */
const connect = async (page: Page, output: string, input: string) => {
  await page.getByLabel(output, { exact: true }).click();
  await page.getByLabel(input, { exact: true }).click();
};

const save = async (page: Page) => {
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
};

// The canvas with its palette and settings panel is a desktop surface.
test.skip(({ isMobile }) => isMobile, "The flow builder is a desktop tool.");

test("an author builds, saves and reopens the CSV tagging flow", async ({
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await signUp({
    email: `flow-author-${suffix}@example.com`,
    name: "Flow Author",
    page,
  });
  await createOrganization({ name: `Flow Studio ${suffix}`, page });
  await createFlow(page, "Tag high-value orders");

  for (const entry of PALETTE_ENTRIES) {
    await addFromPalette(page, entry);
  }
  await expect(nodes(page)).toHaveCount(5);

  await connect(page, "Manual trigger output main", "Parse CSV input");
  await connect(page, "Parse CSV output main", "Find order input");
  await connect(page, "Find order output main", "If input");
  await connect(page, "If output true", "Add tags input");
  await expect(edges(page)).toHaveCount(4);

  // A connection that would loop back, or lead into the trigger, is refused.
  await connect(page, "Add tags output main", "Find order input");
  await connect(page, "Add tags output main", "If input");
  await expect(edges(page)).toHaveCount(4);

  const panel = page.getByTestId("node-config-panel");
  await page.getByTestId("flow-node-manual-1").click();
  await panel.getByRole("button", { name: "Add input" }).click();
  await panel.getByLabel("Input 1 label").fill("CSV file");
  await panel.getByLabel("Input 1 key").fill("csvFile");

  await page.getByTestId("flow-node-parseCsv-1").click();
  await panel.getByLabel("File", { exact: true }).fill("{{ $json.csvFile }}");

  await page.getByTestId("flow-node-findOrder-1").click();
  await panel.getByLabel("Order value").fill("{{ $json.Order }}");

  await page.getByTestId("flow-node-if-1").click();
  await panel.getByLabel("Condition 1 value").fill("{{ $json.Total }}");
  await chooseOption(
    page,
    panel.getByLabel("Condition 1 operator"),
    "is greater than"
  );
  await chooseOption(
    page,
    panel.getByLabel("Condition 1 compare as"),
    "as number"
  );
  await panel.getByLabel("Condition 1 compared with").fill("1000");

  await page.getByTestId("flow-node-addTags-1").click();
  await panel
    .getByLabel("Resource", { exact: true })
    .fill("{{ $json.order.id }}");
  await panel.getByLabel("Add a tag").fill("high-value");
  await panel.getByLabel("Add a tag").press("Enter");
  await panel.getByLabel("Step name").fill("Tag as high value");

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("No issues — ready to run")).toBeVisible();
  await save(page);
  await expect(page.getByText("Saved · v2")).toBeVisible();

  // Reopening shows the same graph and the same configuration.
  await page.reload();
  await expect(nodes(page)).toHaveCount(5);
  await expect(edges(page)).toHaveCount(4);
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await page.getByTestId("flow-node-addTags-1").click();
  await expect(panel.getByLabel("Step name")).toHaveValue("Tag as high value");
  await expect(
    panel.getByRole("button", { name: "Remove tag high-value" })
  ).toBeVisible();
  await expect(panel.getByLabel("Resource", { exact: true })).toHaveValue(
    "{{ $json.order.id }}"
  );
  await page.getByTestId("flow-node-if-1").click();
  await expect(panel.getByLabel("Condition 1 operator")).toContainText(
    "is greater than"
  );
  await expect(panel.getByLabel("Condition 1 compared with")).toHaveValue(
    "1000"
  );
  await page.getByTestId("flow-node-manual-1").click();
  await expect(panel.getByLabel("Input 1 key")).toHaveValue("csvFile");

  // Clearing a required setting is flagged on the step it belongs to.
  await page.getByTestId("flow-node-addTags-1").click();
  await panel.getByRole("button", { name: "Remove tag high-value" }).click();
  await expect(panel).toContainText("At least one tag is required.");
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByLabel("Validation issues")).toContainText(
    "Tag as high value"
  );
  await expect(page.getByLabel("Validation issues")).toContainText(
    "Add at least one tag."
  );
  // The step's card says what is missing; the others stay clean.
  await expect(page.getByTestId("flow-node-addTags-1")).toContainText(
    "Add at least one tag."
  );
  await expect(page.getByTestId("flow-node-if-1")).not.toContainText(
    ISSUE_FOOTER_PATTERN
  );

  expect(errors).toEqual([]);
});

test("a second save of the same version gets a conflict and keeps local edits", async ({
  context,
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  await signUp({
    email: `flow-conflict-${suffix}@example.com`,
    name: "Flow Editor",
    page,
  });
  await createOrganization({ name: `Conflict Studio ${suffix}`, page });
  await createFlow(page, "Shared flow");
  await addFromPalette(page, "Manual trigger");
  await save(page);

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(nodes(other)).toHaveCount(1);

  // The first session saves a rename.
  await page.getByTestId("flow-node-manual-1").click();
  await page.getByLabel("Step name").fill("Saved first");
  await save(page);

  // The second session edited the version that is now stale.
  await other.getByTestId("flow-node-manual-1").click();
  await other.getByLabel("Step name").fill("My local edit");
  await other.getByRole("button", { exact: true, name: "Save" }).click();
  const dialog = other.getByRole("dialog");
  await expect(dialog).toContainText("This flow was changed by someone else");

  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(other.getByLabel("Step name")).toHaveValue("My local edit");
  await expect(other.getByText("Unsaved changes")).toBeVisible();

  await other.getByRole("button", { exact: true, name: "Save" }).click();
  await other.getByRole("button", { name: "Reload newer version" }).click();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await expect(other.getByText("Unsaved changes")).toHaveCount(0);
  await other.getByTestId("flow-node-manual-1").click();
  await expect(other.getByLabel("Step name")).toHaveValue("Saved first");
});

test("someone who can only read flows sees the canvas read-only", async ({
  browser,
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  const viewerEmail = `flow-viewer-${suffix}@example.com`;
  await signUp({
    email: `flow-owner-${suffix}@example.com`,
    name: "Flow Owner",
    page,
  });
  await createOrganization({ name: `Viewer Studio ${suffix}`, page });
  await createFlow(page, "Read me");
  await addFromPalette(page, "Manual trigger");
  await addFromPalette(page, "Parse CSV");
  await save(page);
  const flowUrl = page.url();
  const flowId = flowUrl.split("/").at(-1) as string;

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  try {
    await signUp({ email: viewerEmail, name: "Flow Viewer", page: viewerPage });

    // Before joining the organization, the flow does not exist for them.
    const missing = await viewerPage.goto(flowUrl);
    expect(missing?.status()).toBe(404);

    const flow = await prisma.flow.findUniqueOrThrow({ where: { id: flowId } });
    const viewerRole = await prisma.role.findFirstOrThrow({
      where: { name: "Viewer", organizationId: flow.organizationId },
    });
    const viewer = await prisma.user.findUniqueOrThrow({
      where: { email: viewerEmail },
    });
    await prisma.membership.create({
      data: {
        organizationId: flow.organizationId,
        roleId: viewerRole.id,
        userId: viewer.id,
      },
    });

    await viewerPage.goto(flowUrl);
    await expect(nodes(viewerPage)).toHaveCount(2);
    await expect(viewerPage.getByText("Read-only")).toBeVisible();
    await expect(viewerPage.getByLabel("Node palette")).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { exact: true, name: "Save" })
    ).toHaveCount(0);

    await viewerPage.getByTestId("flow-node-parseCsv-1").click();
    const panel = viewerPage.getByTestId("node-config-panel");
    await expect(panel.getByLabel("Step name")).toBeDisabled();
    await expect(panel.getByLabel("File", { exact: true })).toBeDisabled();
    await expect(panel.getByLabel("Delimiter")).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Delete step" })
    ).toHaveCount(0);

    // Deleting from the keyboard does nothing either.
    await viewerPage.keyboard.press("Delete");
    await expect(nodes(viewerPage)).toHaveCount(2);
  } finally {
    await viewerContext.close();
  }
});
