import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { prisma } from "../../packages/database/src/client";
import { createTestSuffix, E2E_PASSWORD, signUp } from "./support/user-flows";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const RESET_SUBJECT_PREFIX = "Reset your ";
const SIGN_IN_URL_PATTERN = /\/sign-in$/;
const VERIFICATION_URL_PATTERN = /\/verify-email\?/;
const WEB_URL_PATTERN = /https?:\/\/\S+/;
const outboxDirectory = resolve(
  "apps/api",
  process.env.MAIL_OUTBOX_DIR ?? ".data/mail"
);

const registerWithoutVerification = async ({
  email,
  page,
}: {
  email: string;
  page: Page;
}) => {
  await page.goto("/sign-up");
  await page.getByPlaceholder("Full name").fill("Unverified User");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().includes("/api/auth/sign-up/email")
    ),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(page).toHaveURL(VERIFICATION_URL_PATTERN);
};

const findMailUrl = async ({
  email,
  excludedUrl,
  subjectPrefix,
}: {
  email: string;
  excludedUrl?: string;
  subjectPrefix: string;
}) => {
  let files: string[];
  try {
    files = (await readdir(outboxDirectory)).toSorted().toReversed();
  } catch {
    return null;
  }
  for (const file of files.filter((entry) => entry.endsWith(".json"))) {
    const message = JSON.parse(
      await readFile(resolve(outboxDirectory, file), "utf8")
    ) as { subject?: string; text?: string; to?: string };
    const url = message.text?.match(WEB_URL_PATTERN)?.[0];
    if (
      message.to === email &&
      message.subject?.startsWith(subjectPrefix) &&
      url &&
      url !== excludedUrl
    ) {
      return url;
    }
  }
  return null;
};

const requestPasswordReset = async ({
  email,
  excludedUrl,
  page,
}: {
  email: string;
  excludedUrl?: string;
  page: Page;
}) => {
  const response = await page.request.post(
    `${API_URL}/api/auth/request-password-reset`,
    {
      data: { email, redirectTo: "http://localhost:3000/reset-password" },
      headers: { Origin: "http://localhost:3000" },
    }
  );
  expect(response.ok()).toBe(true);
  let resetUrl: string | null = null;
  await expect
    .poll(async () => {
      resetUrl = await findMailUrl({
        email,
        excludedUrl,
        subjectPrefix: RESET_SUBJECT_PREFIX,
      });
      return resetUrl;
    })
    .not.toBeNull();
  if (!resetUrl) {
    throw new Error(`Password reset email was not written for ${email}.`);
  }
  const token = new URL(resetUrl).pathname.split("/").at(-1);
  if (!token) {
    throw new Error("Password reset URL did not contain a token.");
  }
  return { resetUrl, token };
};

test("user can sign up, view dashboard session, and sign out", async ({
  page,
}, testInfo) => {
  const email = `auth-smoke-${createTestSuffix(testInfo)}@example.com`;

  await signUp({ email, name: "Auth Smoke", page });
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("unverified users cannot open protected app surfaces", async ({
  page,
}, testInfo) => {
  const email = `unverified-${createTestSuffix(testInfo)}@example.com`;
  await registerWithoutVerification({ email, page });

  await page.goto("/dashboard");
  await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
});

for (const state of ["suspended", "deleted", "expired-session"] as const) {
  test(`${state} users cannot open protected app surfaces`, async ({
    page,
  }, testInfo) => {
    const email = `${state}-${createTestSuffix(testInfo)}@example.com`;
    await signUp({ email, name: `Blocked ${state}`, page });

    if (state === "suspended") {
      await prisma.user.update({
        data: { status: "SUSPENDED" },
        where: { email },
      });
    } else if (state === "deleted") {
      await prisma.user.delete({ where: { email } });
    } else {
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 60_000) },
        where: { user: { email } },
      });
    }

    await page.goto("/dashboard");
    await expect(page).toHaveURL(SIGN_IN_URL_PATTERN);
  });
}

test("password recovery rejects expired and reused tokens", async ({
  page,
}, testInfo) => {
  const email = `recovery-${createTestSuffix(testInfo)}@example.com`;
  await signUp({ email, name: "Recovery User", page });

  const first = await requestPasswordReset({ email, page });
  const reset = (token: string, newPassword: string) =>
    page.request.post(`${API_URL}/api/auth/reset-password`, {
      data: { newPassword, token },
      headers: { Origin: "http://localhost:3000" },
    });
  expect((await reset(first.token, "UpdatedPassword123!")).ok()).toBe(true);
  expect((await reset(first.token, "ReusedPassword123!")).status()).toBe(400);

  const second = await requestPasswordReset({
    email,
    excludedUrl: first.resetUrl,
    page,
  });
  await prisma.verification.updateMany({
    data: { expiresAt: new Date(Date.now() - 60_000) },
    where: { identifier: `reset-password:${second.token}` },
  });
  expect((await reset(second.token, "ExpiredPassword123!")).status()).toBe(400);
});
