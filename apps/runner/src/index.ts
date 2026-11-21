import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { env } from "../env";
import { createAdmission } from "./admission";
import { createRunnerApp } from "./app";
import { createDepsBuilder } from "./build-deps";
import { createDepsCache } from "./deps-cache";
import { runDocker } from "./docker-cli";
import { createRunner } from "./run-container";
import { createRuntimeImages } from "./runtime-images";
import { clearRunFiles } from "./workspace";

const MEGABYTE = 1024 * 1024;
const GIGABYTE = 1024 * MEGABYTE;
const EVICT_INTERVAL_MS = 60 * 60 * 1000;

/** Removes containers and files a previous agent process left behind. */
const sweepLeftovers = async (workDir: string): Promise<void> => {
  const listed = await runDocker([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    "name=^fn-",
  ]);
  const ids = listed.stdout.split("\n").filter(Boolean);
  if (ids.length > 0) {
    await runDocker(["rm", "--force", ...ids]);
  }
  await clearRunFiles(workDir);
};

const main = async () => {
  if (!env.RUNNER_TOKEN) {
    console.log("Runner agent idle: set RUNNER_TOKEN to serve functions.");
    return;
  }
  const tls =
    env.RUNNER_TLS_CERT && env.RUNNER_TLS_KEY
      ? {
          cert: readFileSync(env.RUNNER_TLS_CERT),
          key: readFileSync(env.RUNNER_TLS_KEY),
        }
      : undefined;
  if (env.NODE_ENV === "production" && !tls) {
    throw new Error(
      "RUNNER_TLS_CERT and RUNNER_TLS_KEY are required in production."
    );
  }

  await sweepLeftovers(env.RUNNER_WORK_DIR);

  const minFreeBytes = env.RUNNER_DEPS_MIN_FREE_GB * GIGABYTE;
  const cache = createDepsCache({
    minFreeBytes,
    root: join(env.RUNNER_WORK_DIR, "deps"),
    targetFreeBytes: 2 * minFreeBytes,
  });
  await cache.sweepIncomplete();
  const evict = () => {
    cache.evict().then(
      (removed) => {
        if (removed.length > 0) {
          console.log(`Removed ${removed.length} unused package installs.`);
        }
      },
      (error: unknown) => console.error("runner.deps_evict_failed", error)
    );
  };
  evict();
  setInterval(evict, EVICT_INTERVAL_MS).unref();

  const images = createRuntimeImages(env.RUNNER_RUNTIMES_DIR);
  const admission = createAdmission(env.RUNNER_MEMORY_BUDGET_MB);
  const config = {
    dns: env.RUNNER_DNS,
    sandboxNetwork: env.RUNNER_SANDBOX_NETWORK,
    workDir: env.RUNNER_WORK_DIR,
  };
  const runner = createRunner({ admission, config, deps: cache, images });
  const deps = createDepsBuilder({
    admission,
    cache,
    config: {
      ...config,
      maxBytes: env.RUNNER_DEPS_MAX_MB * MEGABYTE,
      minFreeBytes,
    },
    images,
  });
  const app = createRunnerApp({
    deps,
    images,
    runner,
    token: env.RUNNER_TOKEN,
  });

  // Built in the background; `/health` reports each runtime once it is ready.
  images.ensureAll().then(() => {
    for (const runtime of images.list()) {
      console.log(
        runtime.ready
          ? `Runtime ${runtime.id} ready (${runtime.image}).`
          : `Runtime ${runtime.id} failed to build: ${runtime.error}`
      );
    }
  });

  const server = serve({
    fetch: app.fetch,
    hostname: env.RUNNER_HOST,
    port: env.RUNNER_PORT,
    ...(tls ? { createServer: createHttpsServer, serverOptions: tls } : {}),
  });
  console.log(
    `Runner agent listening on ${tls ? "https" : "http"}://${env.RUNNER_HOST}:${env.RUNNER_PORT}`
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; stopping runs and the agent.`);
    runner.cancelAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

main().catch((error: unknown) => {
  console.error("runner.startup_failed", error);
  process.exit(1);
});
