import { expect, type Page, test } from "@playwright/test";
import { E2E_SHOPIFY_ACCESS_TOKEN } from "./support/fake-shopify";
import {
  chooseOption,
  connectStoreWithToken,
  createOrganization,
  createTestSuffix,
  signUp,
} from "./support/user-flows";

const HTTP_OK = /HTTP\s*200/;
const NO_GRAPHQL_ERRORS = /GraphQL errors\s*0/;
const EXECUTE_BUTTON = /Execute query/;

const queryEditor = (page: Page) =>
  page.locator(".graphiql-query-editor .view-lines").first();

/** Opens a sidebar plugin; GraphiQL remembers an open one across reloads. */
const openPlugin = async (page: Page, name: string) => {
  const toggle = page.getByRole("button", {
    name: new RegExp(`^(Show|Hide) ${name}$`),
  });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-label"))?.startsWith("Show")) {
    await toggle.click();
  }
};

test("a developer explores, runs and saves a query in the console", async ({
  page,
}, testInfo) => {
  // GraphiQL is a desktop editor: at phone width an open sidebar panel
  // leaves no room for the query editor.
  test.skip(
    testInfo.project.name === "mobile",
    "The console is a desktop tool."
  );
  const suffix = createTestSuffix(testInfo);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await signUp({
    email: `console-${suffix}@example.com`,
    name: "Console Developer",
    page,
  });
  await createOrganization({ name: `Console Studio ${suffix}`, page });
  await connectStoreWithToken({
    accessToken: E2E_SHOPIFY_ACCESS_TOKEN,
    page,
    shopDomain: `console-${suffix}.myshopify.com`.toLowerCase(),
  });

  await page.goto("/graphql");
  await expect(page.locator(".graphiql-container")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByLabel("Store")).toContainText("Fake Store");
  await expect(page.getByLabel("API version")).toContainText("2026-07");

  // The Explorer lists the schema's queries.
  await openPlugin(page, "GraphiQL Explorer");
  const explorer = page.locator(".graphiql-plugin");
  await expect(explorer.getByText("orders", { exact: true })).toBeVisible();
  await expect(explorer.getByText("shop", { exact: true })).toBeVisible();

  // Ticking a field rewrites the query in the editor.
  await expect(queryEditor(page)).not.toContainText("currencyCode");
  await explorer.getByText("currencyCode", { exact: true }).click();
  await expect(queryEditor(page)).toContainText("currencyCode");

  // Running the query shows Shopify's response and the status bar.
  await page.getByRole("button", { name: EXECUTE_BUTTON }).click();
  await expect(page.locator(".graphiql-response")).toContainText("Fake Store");
  const statusBar = page.getByTestId("response-status-bar");
  await expect(statusBar).toContainText(HTTP_OK);
  await expect(statusBar).toContainText(NO_GRAPHQL_ERRORS);
  await expect(statusBar).toContainText("3 req");

  // Mutations appear in the Explorer once a mutation operation is added.
  await explorer.locator("select").selectOption("mutation");
  await explorer.getByRole("button", { name: "+" }).click();
  await expect(explorer.getByText("tagsAdd", { exact: true })).toBeVisible();

  // Saved queries are stored on the server and can be loaded back.
  await openPlugin(page, "Saved queries");
  await page.getByLabel("Saved query name").fill("Shop currency");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    page.locator(".graphiql-plugin").getByText("Shop currency")
  ).toBeVisible();

  // Switching the API version reloads the schema and keeps the open tab.
  const schemaReload = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      (request.postData() ?? "").includes("IntrospectionQuery") &&
      (request.postData() ?? "").includes("2026-04")
  );
  await chooseOption(page, page.getByLabel("API version"), "2026-04");
  await schemaReload;
  await expect(queryEditor(page)).toContainText("currencyCode");

  // A reload restores the tab from browser storage.
  await page.reload();
  await expect(page.locator(".graphiql-container")).toBeVisible({
    timeout: 60_000,
  });
  await expect(queryEditor(page)).toContainText("currencyCode");

  // A fresh tab starts from the default query; loading brings the saved one back.
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(queryEditor(page)).not.toContainText("currencyCode");
  await openPlugin(page, "Saved queries");
  await page.getByRole("button", { name: "Load Shop currency" }).click();
  await expect(queryEditor(page)).toContainText("currencyCode");

  expect(errors).toEqual([]);
});
