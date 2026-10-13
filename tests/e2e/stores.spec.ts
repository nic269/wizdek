import { expect, test } from "@playwright/test";
import { E2E_SHOPIFY_ACCESS_TOKEN } from "./support/fake-shopify";
import {
  createOrganization,
  createTestSuffix,
  signUp,
} from "./support/user-flows";

const SIGN_IN_URL_PATTERN = /\/sign-in/;
const STORES_URL_PATTERN = /\/stores$/;

test("signed-out visitors are sent to sign-in from the stores page", async ({
  page,
}) => {
  await page.goto("/stores");
  await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
});

test("an owner connects a store with an access token", async ({
  page,
}, testInfo) => {
  const suffix = createTestSuffix(testInfo);
  const shopDomain = `e2e-${suffix}.myshopify.com`.toLowerCase();

  await signUp({
    email: `stores-owner-${suffix}@example.com`,
    name: "Stores Owner",
    page,
  });
  await createOrganization({ name: `Stores Studio ${suffix}`, page });

  await page.goto("/stores");
  await expect(page.getByText("No stores connected")).toBeVisible();

  await page.goto("/stores/new");
  await page.getByLabel("Shop domain", { exact: true }).fill(shopDomain);
  await page
    .getByLabel("Admin API access token")
    .fill(E2E_SHOPIFY_ACCESS_TOKEN);
  await page.getByRole("button", { name: "Connect store" }).click();

  await expect(page).toHaveURL(STORES_URL_PATTERN);
  const row = page.getByTestId(`store-${shopDomain}`);
  await expect(row).toContainText("Fake Store");
  await expect(row).toContainText("Connected");
  await expect(row).toContainText("Access token");
  await expect(page.locator("body")).not.toContainText(
    E2E_SHOPIFY_ACCESS_TOKEN
  );
});
