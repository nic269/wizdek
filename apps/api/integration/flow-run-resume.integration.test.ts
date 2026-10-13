import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prisma } from "@repo/database";
import {
  builtInRegistry,
  createAssetReader,
  createFlow,
  createFlowRunJob,
  type FlowDefinition,
  saveFlowVersion,
  startFlowRun,
  uploadFlowFile,
} from "@repo/flows";
import type { JobQueueProvider } from "@repo/jobs";
import { createPgBossJobProvider } from "@repo/jobs/pg-boss";
import { saveToken } from "@repo/shopify/stores";
import {
  type FakeShopifyServer,
  startFakeShopifyServer,
} from "@repo/shopify/testing";
import { createLocalStorageProvider } from "@repo/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

/** A fixed port, so a process left behind by a failed run is identifiable. */
const API_PORT = 3102;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const STORE_TOKEN = "shpat_resume_test_token";
const ROW_COUNT = 300;
const KILL_AFTER_CHECKPOINTS = 100;
const appDirectory = resolve(import.meta.dirname, "..");
const storageDirectory = mkdtempSync(join(tmpdir(), "flow-resume-test-"));
const storage = createLocalStorageProvider(storageDirectory);
const prefix = randomUUID().slice(0, 8);

const children: ChildProcess[] = [];
let server: FakeShopifyServer;
let jobs: JobQueueProvider;
let organizationId: string;
let userId: string;

const sleep = (milliseconds: number) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const until = async (
  condition: () => Promise<boolean>,
  timeoutMs: number,
  what: string
) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await sleep(250);
  }
};

/**
 * Starts the built API as its own process, the way it runs in production.
 * It is launched as a single Node process so that killing it kills the
 * worker itself.
 */
const startApi = async () => {
  const child = spawn(process.execPath, ["dist/index.cjs"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      JOBS_PROVIDER: "pgboss",
      JOBS_WORKER_ENABLED: "true",
      LOCAL_STORAGE_DIR: storageDirectory,
      NEXT_PUBLIC_API_URL: API_URL,
      PORT: String(API_PORT),
      SHOPIFY_ADMIN_BASE_URL_OVERRIDE: server.url,
      STORAGE_PROVIDER: "local",
    },
    stdio: "ignore",
  });
  children.push(child);
  await until(
    async () => {
      try {
        return (await fetch(`${API_URL}/status`)).ok;
      } catch {
        return false;
      }
    },
    30_000,
    "the API to start"
  );
  return child;
};

const csvFlow = (): FlowDefinition => ({
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "main", target: "parse" },
    { id: "e2", source: "parse", sourceHandle: "main", target: "find" },
    { id: "e3", source: "find", sourceHandle: "main", target: "tag" },
  ],
  nodes: [
    {
      config: { inputs: [{ key: "csvFile", label: "CSV file", type: "file" }] },
      id: "trigger",
      name: "Start",
      position: { x: 0, y: 0 },
      type: "trigger.manual",
    },
    {
      config: { file: "{{ $json.csvFile }}" },
      id: "parse",
      name: "Parse",
      position: { x: 260, y: 0 },
      type: "data.parseCsv",
    },
    {
      config: { by: "name", value: "{{ $json.Order }}" },
      id: "find",
      name: "Find",
      position: { x: 520, y: 0 },
      type: "shopify.findOrder",
    },
    {
      config: { resourceId: "{{ $json.order.id }}", tags: ["resumed"] },
      id: "tag",
      name: "Tag",
      position: { x: 780, y: 0 },
      type: "shopify.addTags",
    },
  ],
  schemaVersion: 1,
});

const orderName = (index: number) => `#${prefix}-${index}`;
const orderId = (index: number) => `gid://shopify/Order/${prefix}-${index}`;

/** How many requests of one operation the fake store saw for each order. */
const requestsPerOrder = (operation: string) => {
  const counts = new Map<number, number>();
  for (const { query, variables } of server.graphqlRequests) {
    if (!query.includes(operation)) {
      continue;
    }
    const text = JSON.stringify(variables);
    for (let index = 1; index <= ROW_COUNT; index += 1) {
      if (
        text.includes(`"${orderId(index)}"`) ||
        text.includes(`\\"${orderName(index)}\\"`)
      ) {
        counts.set(index, (counts.get(index) ?? 0) + 1);
        break;
      }
    }
  }
  return counts;
};

beforeAll(async () => {
  execFileSync("pnpm", ["build"], { cwd: appDirectory, stdio: "ignore" });
  server = await startFakeShopifyServer();
  server.acceptToken(STORE_TOKEN);
  server.setLatency(50);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;

  const organization = await prisma.organization.create({
    data: { name: `Resume ${prefix}`, slug: `resume-${prefix}` },
  });
  organizationId = organization.id;
  const user = await prisma.user.create({
    data: {
      email: `resume-${prefix}@example.com`,
      emailVerified: true,
      name: "Resume tester",
      status: "ACTIVE",
    },
  });
  userId = user.id;

  // This process only enqueues; the API process does the work.
  jobs = createPgBossJobProvider({
    connectionString: process.env.DATABASE_URL as string,
    workerEnabled: false,
  });
  jobs.register(
    createFlowRunJob({
      readAsset: createAssetReader(storage),
      registry: builtInRegistry,
    })
  );
}, 120_000);

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
  await jobs?.stop();
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await server?.close();
  rmSync(storageDirectory, { force: true, recursive: true });
  await prisma.$disconnect();
});

describe("flow run across an API crash", () => {
  it("finishes the run after the API process is killed and started again", async () => {
    for (let index = 1; index <= ROW_COUNT; index += 1) {
      server.seedOrder({
        id: orderId(index),
        name: orderName(index),
        tags: [],
        totalPrice: "0",
      });
    }
    const store = await prisma.shopifyStore.create({
      data: {
        apiVersion: "2026-07",
        name: "Fake Store",
        organizationId,
        shopDomain: `resume-${prefix}.myshopify.com`,
        status: "CONNECTED",
        strategy: "STATIC_TOKEN",
      },
    });
    await saveToken(
      store.id,
      {
        accessToken: STORE_TOKEN,
        accessTokenExpiresAt: undefined,
        refreshToken: undefined,
        refreshTokenExpiresAt: undefined,
        scopes: [],
      },
      "revoke"
    );
    const rows = Array.from(
      { length: ROW_COUNT },
      (_, index) => `${orderName(index + 1)},10`
    );
    const file = await uploadFlowFile(
      {
        actorId: userId,
        body: new TextEncoder().encode(`Order,Total\n${rows.join("\n")}\n`),
        contentType: "text/csv",
        fileName: "orders.csv",
        organizationId,
      },
      storage
    );
    const { flow } = await createFlow({
      actorId: userId,
      name: "Resume flow",
      organizationId,
    });
    const scope = { flowId: flow.id, organizationId };
    await saveFlowVersion(scope, {
      actorId: userId,
      baseVersion: 1,
      definition: csvFlow(),
    });

    const firstApi = await startApi();
    await jobs.start();
    const run = await startFlowRun(
      scope,
      { actorId: userId, inputs: { csvFile: file.id }, storeId: store.id },
      { jobs }
    );
    const checkpointed = () =>
      prisma.flowRunItem.count({
        where: { nodeId: "find", runId: run.id, status: "SUCCEEDED" },
      });

    // Kill on an observed amount of progress, not on a timer.
    await until(
      async () => (await checkpointed()) >= KILL_AFTER_CHECKPOINTS,
      60_000,
      "the first hundred items"
    );
    firstApi.kill("SIGKILL");
    await until(
      () => Promise.resolve(firstApi.exitCode !== null || firstApi.killed),
      10_000,
      "the API to die"
    );
    await sleep(500);
    const atKill = await checkpointed();
    expect(atKill).toBeGreaterThanOrEqual(KILL_AFTER_CHECKPOINTS);
    expect(atKill).toBeLessThan(ROW_COUNT);
    const interrupted = await prisma.flowRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(interrupted.status).toBe("RUNNING");

    await startApi();
    await until(
      async () => {
        const current = await prisma.flowRun.findUniqueOrThrow({
          select: { status: true },
          where: { id: run.id },
        });
        return current.status !== "RUNNING" && current.status !== "QUEUED";
      },
      240_000,
      "the run to finish after the restart"
    );

    const finished = await prisma.flowRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(finished.status).toBe("SUCCEEDED");
    for (let index = 1; index <= ROW_COUNT; index += 1) {
      expect(server.order(orderId(index))?.tags).toEqual(["resumed"]);
    }

    // Tagging began only after the restart, so no order was tagged twice.
    const tagRequests = requestsPerOrder("FlowTagsAdd");
    expect(tagRequests.size).toBe(ROW_COUNT);
    expect([...tagRequests.values()].every((count) => count === 1)).toBe(true);

    // A lookup ran twice only for items in flight when the process died:
    // answered by the store, but not yet checkpointed.
    const lookups = requestsPerOrder("FlowFindOrderByName");
    const repeated = [...lookups.values()].filter((count) => count > 1);
    expect(lookups.size).toBe(ROW_COUNT);
    expect(Math.max(...lookups.values())).toBeLessThanOrEqual(2);
    expect(repeated.length).toBeLessThanOrEqual(8);
    const total = [...lookups.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(ROW_COUNT + repeated.length);
  }, 360_000);
});
