import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

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

export const createOrganization = async ({
  name,
  page,
}: {
  name: string;
  page: Page;
}) => {
  await page.getByPlaceholder("Organization name").fill(name);
  await page.getByRole("button", { exact: true, name: "Create" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
};
