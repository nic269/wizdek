import { expect, test } from "@playwright/test";
import {
  createOrganization,
  createTestSuffix,
  signUp,
} from "./support/user-flows";

test("organization lists stay scoped to each authenticated member", async ({
  browser,
  page,
}, testInfo) => {
  const suffix = createTestSuffix(testInfo);
  const firstEmail = `organization-owner-${suffix}@example.com`;
  const secondEmail = `organization-isolated-${suffix}@example.com`;
  const firstOrganization = `First Studio ${suffix}`;
  const secondOrganization = `Second Studio ${suffix}`;

  await signUp({ email: firstEmail, name: "First Owner", page });
  await createOrganization({ name: firstOrganization, page });

  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();

  try {
    await signUp({
      email: secondEmail,
      name: "Isolated Owner",
      page: isolatedPage,
    });
    await expect(
      isolatedPage.getByText(firstOrganization, { exact: true })
    ).toHaveCount(0);

    await createOrganization({ name: secondOrganization, page: isolatedPage });
    await expect(
      isolatedPage.getByText(firstOrganization, { exact: true })
    ).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByText(firstOrganization, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(secondOrganization, { exact: true })
    ).toHaveCount(0);
  } finally {
    await isolatedContext.close();
  }
});
