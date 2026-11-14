import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "line",
  retries: 0,
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4017",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm --config.ignore-scripts=true --filter @repo/app exec next dev app/works/oms-management/_module/tests/e2e/harness --hostname 127.0.0.1 --port 4017",
    cwd: path.resolve(import.meta.dirname, "../../../../../.."),
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4017/works/oms-management",
  },
  workers: 1,
});
