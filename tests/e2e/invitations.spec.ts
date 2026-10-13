import { expect, test } from "@playwright/test";
import {
  completeEmailVerification,
  createOrganization,
  createTestSuffix,
  DASHBOARD_URL_PATTERN,
  E2E_PASSWORD,
  signUp,
} from "./support/user-flows";

const INVITE_URL_PATTERN = /\/invite\//;
const VERIFY_EMAIL_URL_PATTERN = /\/verify-email\?/;

test("owner can invite a member who signs up and accepts access", async ({
  browser,
  page,
}, testInfo) => {
  const suffix = createTestSuffix(testInfo);
  const ownerEmail = `invite-owner-${suffix}@example.com`;
  const memberEmail = `invite-member-${suffix}@example.com`;
  const organizationName = `Invite Studio ${suffix}`;

  await signUp({ email: ownerEmail, name: "Invite Owner", page });
  await createOrganization({ name: organizationName, page });

  await page.goto("/settings/members");
  await page.getByPlaceholder("member@example.com").fill(memberEmail);
  await page.getByRole("button", { name: "Send invite" }).click();
  const inviteLink = page.getByRole("link", { name: INVITE_URL_PATTERN });
  await expect(inviteLink).toBeVisible();
  const inviteUrl = await inviteLink.getAttribute("href");
  if (!inviteUrl) {
    throw new Error("Invitation URL was not returned.");
  }

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  try {
    await memberPage.goto(inviteUrl);
    await memberPage.getByRole("button", { name: "Accept invitation" }).click();
    await memberPage.getByRole("link", { name: "Create account" }).click();
    await memberPage.getByPlaceholder("Full name").fill("Invited Member");
    await memberPage.getByPlaceholder("you@example.com").fill(memberEmail);
    await memberPage.getByPlaceholder("Password").fill(E2E_PASSWORD);
    await memberPage.getByRole("button", { name: "Create account" }).click();
    await expect(memberPage).toHaveURL(VERIFY_EMAIL_URL_PATTERN);
    await completeEmailVerification({
      email: memberEmail,
      expectedUrl: INVITE_URL_PATTERN,
      page: memberPage,
    });
    await expect(memberPage).toHaveURL(INVITE_URL_PATTERN);

    await memberPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(memberPage).toHaveURL(DASHBOARD_URL_PATTERN);
    await expect(
      memberPage.getByText(organizationName, { exact: true })
    ).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
