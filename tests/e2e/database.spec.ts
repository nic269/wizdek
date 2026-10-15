import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  completeEmailVerification,
  createOrganization,
  createTestSuffix,
  DASHBOARD_URL_PATTERN,
  E2E_PASSWORD,
  signUp,
} from "./support/user-flows";

const CONNECTION_URL_PATTERN = /\/database\/(?!new$)[^/]+$/;
const DATABASE_URL_PATTERN = /\/database$/;
const INVITE_URL_PATTERN = /\/invite\//;
const VERIFY_EMAIL_URL_PATTERN = /\/verify-email\?/;
const NO_PERMISSION_PATTERN = /permission/i;
const SIGN_IN_URL_PATTERN = /\/sign-in/;
const ARCHIVE_NAME_PATTERN = /^E2E-source-.+\.dump$/;

/** The database the browser tests run against doubles as the one to back up. */
const databaseUrl = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set for the database browser test.");
  }
  return url;
};

test("signed-out visitors are sent to sign-in from the database page", async ({
  page,
}) => {
  await page.goto("/database");
  await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
});

test("an owner backs up a database, downloads it, and a member has no access", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const suffix = createTestSuffix(testInfo);
  const organizationName = `Database Studio ${suffix}`;
  const memberEmail = `database-member-${suffix}@example.com`;
  const url = databaseUrl();

  await signUp({
    email: `database-owner-${suffix}@example.com`,
    name: "Database Owner",
    page,
  });
  await createOrganization({ name: organizationName, page });

  await page.goto("/database");
  await expect(page.getByText("No database connections")).toBeVisible();

  await page.goto("/database/new");
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("E2E source");
  await sheet.getByLabel("Database URL").fill(url);
  await expect(sheet.getByText("This URL points at localhost")).toBeVisible();
  await sheet.getByRole("button", { name: "Test & save" }).click();
  await expect(page).toHaveURL(CONNECTION_URL_PATTERN, { timeout: 30_000 });
  const connectionPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "E2E source" })).toBeVisible();

  await page.getByRole("button", { name: "Back up now" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Start backup" })
    .click();
  const row = page.locator('[data-testid^="database-backup-"]').first();
  await expect(row).toContainText("Completed", { timeout: 90_000 });

  const downloadEvent = page.waitForEvent("download");
  await row.getByRole("link", { name: "Download" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(ARCHIVE_NAME_PATTERN);
  const archive = await readFile(await download.path());
  // A PostgreSQL custom-format archive starts with this signature.
  expect(archive.subarray(0, 5).toString()).toBe("PGDMP");
  await expect(page.locator("body")).not.toContainText(url);

  // A member of the same organization sees neither the list nor the connection.
  await page.goto("/settings/members");
  await page.getByRole("textbox", { name: "Email address" }).fill(memberEmail);
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
    await memberPage.getByRole("link", { name: "Create account" }).click();
    await memberPage.getByPlaceholder("Full name").fill("Database Member");
    await memberPage.getByPlaceholder("you@example.com").fill(memberEmail);
    await memberPage.getByPlaceholder("Password").fill(E2E_PASSWORD);
    await memberPage.getByRole("button", { name: "Create account" }).click();
    await expect(memberPage).toHaveURL(VERIFY_EMAIL_URL_PATTERN);
    await completeEmailVerification({
      email: memberEmail,
      expectedUrl: INVITE_URL_PATTERN,
      page: memberPage,
    });
    await memberPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(memberPage).toHaveURL(DASHBOARD_URL_PATTERN);

    await memberPage.goto("/database");
    await expect(
      memberPage.getByText(NO_PERMISSION_PATTERN).first()
    ).toBeVisible();
    await expect(memberPage.getByText("E2E source")).toHaveCount(0);
    const detail = await memberPage.goto(connectionPath);
    expect(detail?.status()).toBe(404);
  } finally {
    await memberContext.close();
  }

  // The owner deletes the backup, then the connection.
  await page.goto(connectionPath);
  await row.getByRole("button", { name: "Delete backup" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete backup" })
    .click();
  await expect(page.getByText("No backups")).toBeVisible();

  await page.getByRole("button", { name: "Delete connection…" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete connection" })
    .click();
  await expect(page).toHaveURL(DATABASE_URL_PATTERN);
  await expect(page.getByText("No database connections")).toBeVisible();
});
