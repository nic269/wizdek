import { serve } from "@hono/node-server";
import { createApiApp } from "@repo/api/app";
import { assertApiProviderConfiguration } from "@repo/api/health";
import { getJobProvider, registerJobs } from "@repo/api/jobs";
import { env } from "../env";

assertApiProviderConfiguration();
const app = createApiApp();
const configuredPort =
  process.env.PORT ??
  new URL(env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002").port;
const port = Number(configuredPort || 3002);

const main = async () => {
  const jobs = getJobProvider();
  registerJobs(jobs);
  await jobs.start();

  const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port });
  console.log(`API listening on http://localhost:${port}`);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; stopping jobs and the API.`);
    // Running handlers see their signal abort and get time to checkpoint.
    await jobs.stop().catch((error: unknown) => {
      console.error("jobs.stop_failed", error);
    });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

main().catch((error: unknown) => {
  console.error("api.startup_failed", error);
  process.exit(1);
});
