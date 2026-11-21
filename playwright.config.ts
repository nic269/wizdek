import { defineConfig, devices } from "@playwright/test";
import { E2E_RUNNER_TOKEN } from "./tests/e2e/support/fake-runner";
import { E2E_SHOPIFY_ACCESS_TOKEN } from "./tests/e2e/support/fake-shopify";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER !== "false";

// The app and API listen where the environment says, as they do in `pnpm dev`.
const appUrl = new URL(
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
);
const apiUrl = new URL(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002"
);

// The API talks to this stand-in instead of Shopify during browser tests.
const fakeShopifyPort = process.env.FAKE_SHOPIFY_PORT ?? "3999";
const fakeShopifyUrl = `http://127.0.0.1:${fakeShopifyPort}`;

// And to this stand-in for the functions runner.
const fakeRunnerPort = process.env.FAKE_RUNNER_PORT ?? "3998";
const fakeRunnerUrl = `http://127.0.0.1:${fakeRunnerPort}`;

export default defineConfig({
  fullyParallel: true,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  testDir: "./tests/e2e",
  use: {
    baseURL: appUrl.origin,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @repo/shopify fake-server",
      env: {
        FAKE_SHOPIFY_ACCEPT_TOKENS: E2E_SHOPIFY_ACCESS_TOKEN,
        FAKE_SHOPIFY_PORT: fakeShopifyPort,
      },
      reuseExistingServer,
      timeout: 60_000,
      url: `${fakeShopifyUrl}/health`,
    },
    {
      command: "pnpm --filter @repo/functions fake-runner",
      env: {
        FAKE_RUNNER_PORT: fakeRunnerPort,
        FAKE_RUNNER_TOKEN: E2E_RUNNER_TOKEN,
      },
      reuseExistingServer,
      timeout: 60_000,
      // Answers 401 without the token, which still shows it is up.
      url: `${fakeRunnerUrl}/health`,
    },
    {
      command: "pnpm --filter @repo/api-app dev",
      env: {
        FUNCTIONS_RUNNER_TOKEN: E2E_RUNNER_TOKEN,
        FUNCTIONS_RUNNER_URL: fakeRunnerUrl,
        SHOPIFY_ADMIN_BASE_URL_OVERRIDE: fakeShopifyUrl,
      },
      reuseExistingServer,
      timeout: 120_000,
      url: `${apiUrl.origin}/status`,
    },
    {
      command: `pnpm --filter @repo/app exec dotenv -e ../../.env -- next dev --port ${appUrl.port || "3000"}`,
      reuseExistingServer,
      timeout: 120_000,
      url: `${appUrl.origin}/sign-in`,
    },
  ],
  workers: 2,
});
