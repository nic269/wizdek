import { defineConfig, devices } from "@playwright/test";
import { E2E_SHOPIFY_ACCESS_TOKEN } from "./tests/e2e/support/fake-shopify";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER !== "false";

// The API talks to this stand-in instead of Shopify during browser tests.
const fakeShopifyPort = process.env.FAKE_SHOPIFY_PORT ?? "3999";
const fakeShopifyUrl = `http://127.0.0.1:${fakeShopifyPort}`;

export default defineConfig({
  fullyParallel: true,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
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
      command: "pnpm --filter @repo/api-app dev",
      env: { SHOPIFY_ADMIN_BASE_URL_OVERRIDE: fakeShopifyUrl },
      reuseExistingServer,
      timeout: 120_000,
      url: "http://localhost:3002/status",
    },
    {
      command: "pnpm --filter @repo/app dev",
      reuseExistingServer,
      timeout: 120_000,
      url: "http://localhost:3000/sign-in",
    },
  ],
  workers: 2,
});
