import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER !== "false";

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
      command: "pnpm --filter @repo/api-app dev",
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
