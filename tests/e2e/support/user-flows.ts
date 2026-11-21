import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const SWITCHER_NAME = /^Switch organization/;
export const DASHBOARD_URL_PATTERN = /\/dashboard$/;
export const E2E_PASSWORD = "Password123!";
const VERIFICATION_SUBJECT_PREFIX = "Verify your ";
const VERIFICATION_URL_PATTERN = /\/verify-email\?/;
const WEB_URL_PATTERN = /https?:\/\/\S+/;
const outboxDirectory = resolve(
  "apps/api",
  process.env.MAIL_OUTBOX_DIR ?? ".data/mail"
);

const findVerificationUrl = async (email: string) => {
  let files: string[];
  try {
    files = await readdir(outboxDirectory);
  } catch {
    return null;
  }

  for (const file of files
    .filter((entry) => entry.endsWith(".json"))
    .toReversed()) {
    const message = JSON.parse(
      await readFile(resolve(outboxDirectory, file), "utf8")
    ) as { subject?: string; text?: string; to?: string };
    if (
      message.to !== email ||
      !message.subject?.startsWith(VERIFICATION_SUBJECT_PREFIX)
    ) {
      continue;
    }

    return message.text?.match(WEB_URL_PATTERN)?.[0] ?? null;
  }

  return null;
};

export const completeEmailVerification = async ({
  email,
  expectedUrl = DASHBOARD_URL_PATTERN,
  page,
}: {
  email: string;
  expectedUrl?: RegExp;
  page: Page;
}) => {
  let verificationUrl: string | null = null;
  await expect
    .poll(async () => {
      verificationUrl = await findVerificationUrl(email);
      return verificationUrl;
    })
    .not.toBeNull();

  if (!verificationUrl) {
    throw new Error(`Verification email was not written for ${email}.`);
  }

  await page.goto(verificationUrl);
  await expect(page).toHaveURL(expectedUrl, { timeout: 15_000 });
};

export const createTestSuffix = (testInfo: TestInfo) =>
  [
    testInfo.project.name,
    testInfo.parallelIndex,
    testInfo.retry,
    Date.now(),
  ].join("-");

export const signUp = async ({
  email,
  name,
  page,
}: {
  email: string;
  name: string;
  page: Page;
}) => {
  await page.goto("/sign-up");
  await page.getByPlaceholder("Full name").fill(name);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().includes("/api/auth/sign-up/email")
    ),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);

  if (!response.ok()) {
    throw new Error(
      `Signup failed with ${response.status()}: ${await response.text()}`
    );
  }

  await expect(page).toHaveURL(VERIFICATION_URL_PATTERN, { timeout: 15_000 });
  await completeEmailVerification({ email, page });
};

/**
 * On narrow screens the navigation, organization switcher and account menu
 * live in a sheet. Opens it when the page shows the menu button, and says
 * whether it did.
 */
export const openShellNavigation = async (page: Page) => {
  const open = page.getByRole("button", { name: "Open navigation" });
  if (!(await open.isVisible())) {
    return false;
  }
  await open.click();
  return true;
};

const closeShellNavigation = async (page: Page) => {
  await page.getByRole("button", { name: "Close navigation" }).click();
};

/** Checks which organization the switcher shows as active. */
export const expectActiveOrganization = async (page: Page, name: string) => {
  const opened = await openShellNavigation(page);
  await expect(
    page.getByRole("button", { name: `Switch organization, current: ${name}` })
  ).toBeVisible();
  if (opened) {
    await closeShellNavigation(page);
  }
};

/**
 * Creates an organization and makes it the active one: from the empty state
 * for someone without one, otherwise from the switcher's menu.
 */
export const createOrganization = async ({
  name,
  page,
}: {
  name: string;
  page: Page;
}) => {
  const firstName = page.getByLabel("Organization name", { exact: true });
  const switcher = page.getByRole("button", { name: SWITCHER_NAME });
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  await expect(firstName.or(switcher).or(openNavigation)).toBeVisible();
  // On narrow screens the switcher is in the navigation sheet, and the menu
  // button shows before the page knows whether an organization exists.
  const opened = await openShellNavigation(page);
  await expect(firstName.or(switcher)).toBeVisible();
  if (await firstName.isVisible()) {
    if (opened) {
      await closeShellNavigation(page);
    }
    await firstName.fill(name);
    await page.getByRole("button", { name: "Create organization" }).click();
  } else {
    await page.getByRole("menuitem", { name: "Create organization" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { exact: true, name: "Create" }).click();
  }
  await expectActiveOrganization(page, name);
};

export const connectStoreWithToken = async ({
  accessToken,
  page,
  shopDomain,
}: {
  accessToken: string;
  page: Page;
  shopDomain: string;
}) => {
  await page.goto("/stores/new");
  await page.getByLabel("Shop domain", { exact: true }).fill(shopDomain);
  await page.getByLabel("Admin API access token").fill(accessToken);
  await page.getByRole("button", { name: "Connect store" }).click();
  await expect(page.getByTestId(`store-${shopDomain}`)).toContainText(
    "Connected"
  );
};

/**
 * Picks an option of a shadcn Select. Its options open in a popup outside the
 * trigger's container, so they are looked up on the page.
 */
export const chooseOption = async (
  page: Page,
  trigger: Locator,
  option: string
) => {
  await trigger.click();
  await page.getByRole("option", { exact: true, name: option }).click();
};
