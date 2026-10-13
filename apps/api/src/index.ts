import { serve } from "@hono/node-server";
import { createApiApp } from "@repo/api/app";
import { assertApiProviderConfiguration } from "@repo/api/health";
import { env } from "../env";

assertApiProviderConfiguration();
const app = createApiApp();
const configuredPort =
  process.env.PORT ??
  new URL(env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002").port;
const port = Number(configuredPort || 3002);

serve({ fetch: app.fetch, hostname: "0.0.0.0", port });

console.log(`API listening on http://localhost:${port}`);
