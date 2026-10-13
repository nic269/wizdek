import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { createLocalJobProvider, type JobQueueProvider } from "@repo/jobs";
import { createPgBossJobProvider } from "@repo/jobs/pg-boss";
import { createStoreClient, saveToken } from "@repo/shopify/stores";
import {
  type FakeShopifyServer,
  startFakeShopifyServer,
} from "@repo/shopify/testing";
import { createMemoryStorageProvider } from "@repo/storage";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { z } from "zod";
import {
  type AnyNodeDefinition,
  builtInNodes,
  createAssetReader,
  createFlow,
  createFlowRunJob,
  createNodeRegistry,
  defineNode,
  defineNodeSpec,
  type ExecutorDependencies,
  executeFlowRun,
  type FlowDefinition,
  FlowServiceError,
  saveFlowVersion,
  startFlowRun,
  uploadFlowFile,
} from "../src";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const STORE_TOKEN = "shpat_flow_engine_token";
const HIGH_VALUE = "high-value";
const STANDARD = "standard";

const storage = createMemoryStorageProvider();
const organizationIds: string[] = [];
const userIds: string[] = [];
const providers: JobQueueProvider[] = [];
let server: FakeShopifyServer;

/** A node whose effect must not be repeated, standing in for a charge or refund. */
const chargeLog: string[] = [];
let chargeBehaviour: (key: string, signal: AbortSignal) => Promise<void> = () =>
  Promise.resolve();
const chargeNode = defineNode(
  defineNodeSpec({
    category: "action",
    configSchema: z.object({}),
    description: "Charges once per item.",
    idempotent: false,
    label: "Charge",
    mode: "item",
    outputs: ["main"],
    type: "test.charge",
  }),
  async ({ ctx, item }) => {
    chargeLog.push(item.key);
    await chargeBehaviour(item.key, ctx.signal);
    return { outputs: [{ handle: "main", json: item.json }] };
  }
);

const registry = createNodeRegistry([
  ...builtInNodes,
  chargeNode as AnyNodeDefinition,
]);

const node = (
  id: string,
  type: string,
  config: Record<string, unknown> = {}
) => ({
  config,
  id,
  name: id,
  position: { x: 0, y: 0 },
  type,
});

const edge = (source: string, target: string, sourceHandle = "main") => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

/** The example flow: CSV rows, each order tagged by its total. */
const csvTaggingFlow = (): FlowDefinition => ({
  edges: [
    edge("trigger", "parse"),
    edge("parse", "find"),
    edge("find", "check"),
    edge("check", "tagHigh", "true"),
    edge("check", "tagStandard", "false"),
  ],
  nodes: [
    node("trigger", "trigger.manual", {
      inputs: [{ key: "csvFile", label: "CSV file", type: "file" }],
    }),
    node("parse", "data.parseCsv", { file: "{{ $json.csvFile }}" }),
    node("find", "shopify.findOrder", {
      by: "name",
      value: "{{ $json.Order }}",
    }),
    node("check", "logic.if", {
      conditions: [
        {
          left: "{{ $json.Total }}",
          operator: "gt",
          right: "1000",
          valueType: "number",
        },
      ],
    }),
    node("tagHigh", "shopify.addTags", {
      resourceId: "{{ $json.order.id }}",
      tags: [HIGH_VALUE],
    }),
    node("tagStandard", "shopify.addTags", {
      resourceId: "{{ $json.order.id }}",
      tags: [STANDARD],
    }),
  ],
  schemaVersion: 1,
});

const chargeFlow = (): FlowDefinition => ({
  edges: [edge("trigger", "parse"), edge("parse", "charge")],
  nodes: [
    node("trigger", "trigger.manual", {
      inputs: [{ key: "csvFile", label: "CSV file", type: "file" }],
    }),
    node("parse", "data.parseCsv", { file: "{{ $json.csvFile }}" }),
    node("charge", "test.charge"),
  ],
  schemaVersion: 1,
});

interface Workspace {
  organizationId: string;
  prefix: string;
  storeId: string;
  userId: string;
}

const createWorkspace = async (): Promise<Workspace> => {
  const prefix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Flows ${prefix}`, slug: `flows-${prefix}` },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      email: `flows-${prefix}@example.com`,
      emailVerified: true,
      name: "Flow tester",
      status: "ACTIVE",
    },
  });
  userIds.push(user.id);
  const store = await prisma.shopifyStore.create({
    data: {
      apiVersion: "2026-07",
      name: "Fake Store",
      organizationId: organization.id,
      shopDomain: `flows-${prefix}.myshopify.com`,
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
  return {
    organizationId: organization.id,
    prefix,
    storeId: store.id,
    userId: user.id,
  };
};

/** Seeds `count` orders; odd ones total above 1,000 and even ones below. */
const seedOrders = (workspace: Workspace, count: number) => {
  const orders = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      highValue: number % 2 === 1,
      id: `gid://shopify/Order/${workspace.prefix}-${number}`,
      name: `#${workspace.prefix}-${number}`,
      total: number % 2 === 1 ? `$1,${500 + number}.00` : `${200 + number}.50`,
    };
  });
  for (const order of orders) {
    server.seedOrder({
      id: order.id,
      name: order.name,
      tags: [],
      totalPrice: "0",
    });
  }
  return orders;
};

const toCsv = (rows: { name: string; total: string }[]) =>
  `Order,Total\n${rows.map(({ name, total }) => `${name},"${total}"`).join("\n")}\n`;

const createRun = async (
  workspace: Workspace,
  definition: FlowDefinition,
  csv: string
) => {
  const file = await uploadFlowFile(
    {
      actorId: workspace.userId,
      body: new TextEncoder().encode(csv),
      contentType: "text/csv",
      fileName: "orders.csv",
      organizationId: workspace.organizationId,
    },
    storage
  );
  const { flow } = await createFlow({
    actorId: workspace.userId,
    name: `Flow ${randomUUID().slice(0, 6)}`,
    organizationId: workspace.organizationId,
  });
  const { version } = await saveFlowVersion(
    { flowId: flow.id, organizationId: workspace.organizationId },
    { actorId: workspace.userId, baseVersion: 1, definition },
    registry
  );
  const run = await prisma.flowRun.create({
    data: {
      flowId: flow.id,
      flowVersionId: version.id,
      organizationId: workspace.organizationId,
      startedById: workspace.userId,
      storeId: workspace.storeId,
      triggerPayload: { csvFile: file.id },
      triggerType: "manual",
    },
  });
  return { fileId: file.id, flowId: flow.id, runId: run.id };
};

const dependencies = (
  overrides: Partial<ExecutorDependencies> = {}
): ExecutorDependencies => ({
  readAsset: createAssetReader(storage),
  registry,
  ...overrides,
});

const itemsOf = (runId: string, nodeId?: string) =>
  prisma.flowRunItem.findMany({
    orderBy: { ordinal: "asc" },
    where: { runId, ...(nodeId ? { nodeId } : {}) },
  });

const statusCounts = async (runId: string, nodeId: string) => {
  const counts: Record<string, number> = {};
  for (const item of await itemsOf(runId, nodeId)) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
};

const runOf = (runId: string) =>
  prisma.flowRun.findUniqueOrThrow({ where: { id: runId } });

/** Admin requests the fake server saw for this workspace, by operation. */
const requestsFor = (workspace: Workspace, operation: string) =>
  server.graphqlRequests.filter(
    ({ query, variables }) =>
      query.includes(operation) &&
      JSON.stringify(variables).includes(workspace.prefix)
  );

/**
 * Wraps the store client so a test can act after a number of Shopify
 * requests, for example to stop the process mid-run.
 */
const afterRequests =
  (
    count: number,
    action: () => void | Promise<void>
  ): typeof createStoreClient =>
  async (scope, options) => {
    const client = await createStoreClient(scope, options);
    let seen = 0;
    return {
      ...client,
      requestWithRetry: async (request, retryOptions) => {
        const result = await client.requestWithRetry(request, retryOptions);
        seen += 1;
        if (seen === count) {
          await action();
        }
        return result;
      },
    };
  };

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken(STORE_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
});

beforeEach(() => {
  chargeLog.length = 0;
  chargeBehaviour = () => Promise.resolve();
  server.setThrottleEvery(0);
  server.acceptToken(STORE_TOKEN);
});

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.stop()));
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds.splice(0) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

afterAll(async () => {
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  await server.close();
  await prisma.$disconnect();
});

describe("the CSV order-tagging flow", () => {
  it("tags all 50 orders with the tag their total dictates", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 50);
    const { runId } = await createRun(
      workspace,
      csvTaggingFlow(),
      toCsv(orders)
    );

    await expect(executeFlowRun(runId, dependencies())).resolves.toBe(
      "finished"
    );

    const run = await runOf(runId);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.completedAt).toBeInstanceOf(Date);
    for (const order of orders) {
      expect(server.order(order.id)?.tags).toEqual([
        order.highValue ? HIGH_VALUE : STANDARD,
      ]);
    }
    expect(requestsFor(workspace, "FlowFindOrderByName")).toHaveLength(50);
    expect(requestsFor(workspace, "FlowTagsAdd")).toHaveLength(50);
    await expect(statusCounts(runId, "parse")).resolves.toEqual({
      SUCCEEDED: 1,
    });
    await expect(statusCounts(runId, "find")).resolves.toEqual({
      SUCCEEDED: 50,
    });
    await expect(statusCounts(runId, "tagHigh")).resolves.toEqual({
      SUCCEEDED: 25,
    });
    await expect(statusCounts(runId, "tagStandard")).resolves.toEqual({
      SUCCEEDED: 25,
    });
    const steps = await prisma.flowRunStep.findMany({ where: { runId } });
    expect(steps.map(({ status }) => status)).toEqual(
      Array.from({ length: 6 }, () => "SUCCEEDED")
    );
    // The order name travels as a quoted search value in a variable.
    expect(requestsFor(workspace, "FlowFindOrderByName")[0]?.variables).toEqual(
      {
        query: `name:"${orders[0]?.name}"`,
      }
    );
  });

  it("fails only the row with an unknown order and reports why", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 6);
    const rows = [
      ...orders.slice(0, 3),
      { name: `#${workspace.prefix}-missing`, total: "50" },
      ...orders.slice(3),
      { name: orders[0]?.name ?? "", total: "not a number" },
    ];
    const { runId } = await createRun(workspace, csvTaggingFlow(), toCsv(rows));

    await executeFlowRun(runId, dependencies());

    expect((await runOf(runId)).status).toBe("PARTIALLY_FAILED");
    const failedLookups = (await itemsOf(runId, "find")).filter(
      ({ status }) => status === "FAILED"
    );
    expect(failedLookups).toHaveLength(1);
    expect(failedLookups[0]?.error).toMatchObject({
      message: `No order found for "#${workspace.prefix}-missing".`,
    });
    expect(failedLookups[0]?.input).toMatchObject({ $row: 5 });
    const failedChecks = (await itemsOf(runId, "check")).filter(
      ({ status }) => status === "FAILED"
    );
    expect(failedChecks).toHaveLength(1);
    expect(failedChecks[0]?.error).toMatchObject({
      message: '"not a number" is not a number.',
    });
    for (const order of orders) {
      expect(server.order(order.id)?.tags).toHaveLength(1);
    }
  });

  it("leaves exactly one copy of each tag when the same CSV runs twice", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 10);
    const csv = toCsv(orders);

    for (const _attempt of [1, 2]) {
      const { runId } = await createRun(workspace, csvTaggingFlow(), csv);
      await executeFlowRun(runId, dependencies());
      expect((await runOf(runId)).status).toBe("SUCCEEDED");
    }

    for (const order of orders) {
      expect(server.order(order.id)?.tags).toEqual([
        order.highValue ? HIGH_VALUE : STANDARD,
      ]);
    }
    expect(requestsFor(workspace, "FlowTagsAdd")).toHaveLength(20);
  });

  it("completes with no failed item while Shopify throttles intermittently", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 20);
    const { runId } = await createRun(
      workspace,
      csvTaggingFlow(),
      toCsv(orders)
    );
    server.setThrottleEvery(3);

    await executeFlowRun(runId, dependencies());
    server.setThrottleEvery(0);

    expect((await runOf(runId)).status).toBe("SUCCEEDED");
    const statuses = new Set(
      (await itemsOf(runId)).map(({ status }) => status)
    );
    expect([...statuses]).toEqual(["SUCCEEDED"]);
    // More requests than items, because throttled ones were sent again.
    expect(requestsFor(workspace, "FlowTagsAdd").length).toBeGreaterThan(20);
    for (const order of orders) {
      expect(server.order(order.id)?.tags).toHaveLength(1);
    }
  });
});

describe("interruption and resume", () => {
  it("resumes after being stopped without repeating a checkpointed item", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 30);
    const { runId } = await createRun(
      workspace,
      csvTaggingFlow(),
      toCsv(orders)
    );
    const stop = new AbortController();

    const first = await executeFlowRun(
      runId,
      dependencies({
        createStoreClient: afterRequests(17, () => stop.abort()),
        signal: stop.signal,
      })
    );

    expect(first).toBe("interrupted");
    expect((await runOf(runId)).status).toBe("RUNNING");
    const checkpointed = (await itemsOf(runId)).filter(
      ({ status }) => status === "SUCCEEDED"
    );
    const lookedUp = checkpointed.filter(({ nodeId }) => nodeId === "find");
    expect(lookedUp.length).toBeGreaterThan(0);
    expect(lookedUp.length).toBeLessThan(30);
    const lookupsBeforeResume = requestsFor(
      workspace,
      "FlowFindOrderByName"
    ).length;

    await expect(executeFlowRun(runId, dependencies())).resolves.toBe(
      "finished"
    );

    expect((await runOf(runId)).status).toBe("SUCCEEDED");
    for (const order of orders) {
      expect(server.order(order.id)?.tags).toEqual([
        order.highValue ? HIGH_VALUE : STANDARD,
      ]);
    }
    // Every checkpointed row is untouched: same attempt count, same timestamp.
    const after = new Map(
      (await itemsOf(runId)).map((item) => [item.id, item])
    );
    for (const item of checkpointed) {
      expect(after.get(item.id)).toMatchObject({
        attempts: 1,
        updatedAt: item.updatedAt,
      });
    }
    // Only orders without a checkpoint were looked up after the restart.
    const lookupsAfterResume =
      requestsFor(workspace, "FlowFindOrderByName").length -
      lookupsBeforeResume;
    expect(lookupsAfterResume).toBe(30 - lookedUp.length);
  });

  it("ends canceled with the remaining items pending", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 30);
    const { runId } = await createRun(
      workspace,
      csvTaggingFlow(),
      toCsv(orders)
    );

    await executeFlowRun(
      runId,
      dependencies({
        createStoreClient: afterRequests(9, async () => {
          await prisma.flowRun.update({
            data: { cancelRequestedAt: new Date() },
            where: { id: runId },
          });
        }),
      })
    );

    const run = await runOf(runId);
    expect(run.status).toBe("CANCELED");
    expect(run.completedAt).toBeInstanceOf(Date);
    const counts = await statusCounts(runId, "find");
    expect(counts.PENDING).toBeGreaterThan(0);
    expect((counts.SUCCEEDED ?? 0) + (counts.PENDING ?? 0)).toBe(30);
    // A canceled run stays canceled.
    await executeFlowRun(runId, dependencies());
    expect((await runOf(runId)).status).toBe("CANCELED");
    await expect(statusCounts(runId, "find")).resolves.toEqual(counts);
  });

  it("marks a non-idempotent item interrupted mid-call as unknown and never repeats it", async () => {
    const workspace = await createWorkspace();
    const rows = Array.from({ length: 5 }, (_, index) => ({
      name: `row-${index}`,
      total: "1",
    }));
    const { runId } = await createRun(workspace, chargeFlow(), toCsv(rows));
    const stop = new AbortController();
    // The third charge is in flight when the process stops.
    chargeBehaviour = (key, signal) =>
      key === "0.2"
        ? new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
            stop.abort(new Error("process stopping"));
          })
        : Promise.resolve();

    const first = await executeFlowRun(
      runId,
      dependencies({ signal: stop.signal })
    );

    expect(first).toBe("interrupted");
    const interrupted = (await itemsOf(runId, "charge")).find(
      ({ itemKey }) => itemKey === "0.2"
    );
    expect(interrupted?.status).toBe("IN_PROGRESS");

    chargeBehaviour = () => Promise.resolve();
    await executeFlowRun(runId, dependencies());

    expect((await runOf(runId)).status).toBe("PARTIALLY_FAILED");
    const charges = await itemsOf(runId, "charge");
    expect(charges.map(({ itemKey, status }) => [itemKey, status])).toEqual([
      ["0.0", "SUCCEEDED"],
      ["0.1", "SUCCEEDED"],
      ["0.2", "UNKNOWN"],
      ["0.3", "SUCCEEDED"],
      ["0.4", "SUCCEEDED"],
    ]);
    expect(charges[2]?.error).toMatchObject({ name: "InterruptedError" });
    // Each item was attempted exactly once across both executions.
    expect([...chargeLog].sort()).toEqual(["0.0", "0.1", "0.2", "0.3", "0.4"]);
  });

  it("fails the run and keeps the remaining items pending when the store rejects its credentials", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 12);
    const { runId } = await createRun(
      workspace,
      csvTaggingFlow(),
      toCsv(orders)
    );

    await executeFlowRun(
      runId,
      dependencies({
        createStoreClient: afterRequests(4, () =>
          server.revokeToken(STORE_TOKEN)
        ),
      })
    );

    const run = await runOf(runId);
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatchObject({ nodeId: "find" });
    expect(JSON.stringify(run.error)).toContain("Reconnect the store");
    const counts = await statusCounts(runId, "find");
    expect(counts.FAILED).toBeUndefined();
    expect(counts.PENDING).toBeGreaterThan(0);
    await expect(
      prisma.flowRunStep.findFirstOrThrow({ where: { nodeId: "find", runId } })
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(
      prisma.shopifyStore.findUniqueOrThrow({
        where: { id: workspace.storeId },
      })
    ).resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
  });
});

describe("starting runs", () => {
  const prepareFlow = async (
    workspace: Workspace,
    definition: FlowDefinition
  ) => {
    const { flowId, fileId } = await createRun(
      workspace,
      definition,
      "Order,Total\n"
    );
    return {
      fileId,
      scope: { flowId, organizationId: workspace.organizationId },
    };
  };

  it("runs a started flow through the durable job queue", async () => {
    const workspace = await createWorkspace();
    const orders = seedOrders(workspace, 8);
    const { flowId } = await createRun(
      workspace,
      csvTaggingFlow(),
      "Order,Total\n"
    );
    const file = await uploadFlowFile(
      {
        actorId: workspace.userId,
        body: new TextEncoder().encode(toCsv(orders)),
        contentType: "text/csv",
        fileName: "orders.csv",
        organizationId: workspace.organizationId,
      },
      storage
    );
    const schema = `pgboss_flows_${workspace.prefix}`;
    const jobs = createPgBossJobProvider({
      connectionString: process.env.DATABASE_URL as string,
      pollingIntervalSeconds: 0.5,
      schema,
    });
    providers.push(jobs);
    jobs.register(createFlowRunJob(dependencies()));
    await jobs.start();

    const run = await startFlowRun(
      { flowId, organizationId: workspace.organizationId },
      {
        actorId: workspace.userId,
        inputs: { csvFile: file.id },
        storeId: workspace.storeId,
      },
      { jobs, registry }
    );
    expect(run.status).toBe("QUEUED");
    await jobs.waitUntilIdle();

    expect((await runOf(run.id)).status).toBe("SUCCEEDED");
    for (const order of orders) {
      expect(server.order(order.id)?.tags).toHaveLength(1);
    }
    await jobs.stop();
    providers.length = 0;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }, 60_000);

  it("rejects a store or a file from another organization, and an invalid flow", async () => {
    const workspace = await createWorkspace();
    const other = await createWorkspace();
    const jobs = createLocalJobProvider();
    const { fileId, scope } = await prepareFlow(workspace, csvTaggingFlow());
    const foreign = await prepareFlow(other, csvTaggingFlow());
    const runsBefore = await prisma.flowRun.count();
    const start = (
      inputs: Record<string, unknown>,
      storeId: string,
      target = scope
    ) =>
      startFlowRun(
        target,
        { actorId: workspace.userId, inputs, storeId },
        { jobs, registry }
      ).catch((caught: unknown) => caught);

    await expect(
      start({ csvFile: fileId }, other.storeId)
    ).resolves.toMatchObject({
      failure: "STORE_NOT_AVAILABLE",
    });
    await expect(
      start({ csvFile: foreign.fileId }, workspace.storeId)
    ).resolves.toMatchObject({ failure: "INPUT_INVALID" });
    await expect(start({}, workspace.storeId)).resolves.toMatchObject({
      failure: "INPUT_INVALID",
    });
    await expect(
      start({ csvFile: fileId }, workspace.storeId, foreign.scope)
    ).resolves.toMatchObject({ failure: "STORE_NOT_AVAILABLE" });

    const broken = csvTaggingFlow();
    broken.nodes.push(node("orphan", "shopify.addTags"));
    const invalid = await prepareFlow(workspace, broken);
    const error = await start(
      { csvFile: invalid.fileId },
      workspace.storeId,
      invalid.scope
    );
    expect(error).toBeInstanceOf(FlowServiceError);
    expect(error).toMatchObject({ failure: "FLOW_INVALID" });
    expect(
      (error as FlowServiceError).issues?.map(({ nodeId }) => nodeId)
    ).toContain("orphan");

    // Nothing was queued: the only new run is the invalid flow's own fixture.
    await expect(prisma.flowRun.count()).resolves.toBe(runsBefore + 1);
  });

  it("refuses to overwrite a version someone else saved", async () => {
    const workspace = await createWorkspace();
    const { scope } = await prepareFlow(workspace, csvTaggingFlow());
    const save = (baseVersion: number) =>
      saveFlowVersion(
        scope,
        {
          actorId: workspace.userId,
          baseVersion,
          definition: csvTaggingFlow(),
        },
        registry
      );

    await expect(save(1)).rejects.toMatchObject({
      failure: "VERSION_CONFLICT",
    });
    const saved = await save(2);
    expect(saved.version.version).toBe(3);
    expect(saved.validation.valid).toBe(true);
    const [racing, raced] = await Promise.allSettled([save(3), save(3)]);
    expect([racing.status, raced.status].sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });
});
