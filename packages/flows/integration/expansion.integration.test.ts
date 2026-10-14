import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { createStoreClient, saveToken } from "@repo/shopify/stores";
import {
  type FakeShopifyServer,
  startFakeShopifyServer,
} from "@repo/shopify/testing";
import { createMemoryStorageProvider } from "@repo/storage";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  builtInRegistry,
  createAssetReader,
  createFlow,
  type ExecutorDependencies,
  executeFlowRun,
  type FlowDefinition,
  saveFlowVersion,
  uploadFlowFile,
} from "../src";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const STORE_TOKEN = "shpat_expansion_token";
const TAG_MUTATION =
  "mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }";

const storage = createMemoryStorageProvider();
const organizationIds: string[] = [];
const userIds: string[] = [];
let server: FakeShopifyServer;

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

const csvSource = [
  node("trigger", "trigger.manual", {
    inputs: [{ key: "csvFile", label: "CSV file", type: "file" }],
  }),
  node("parse", "data.parseCsv", { file: "{{ $json.csvFile }}" }),
];

const createRun = async (definition: FlowDefinition, csv: string) => {
  const prefix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Expansion ${prefix}`, slug: `expansion-${prefix}` },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      email: `expansion-${prefix}@example.com`,
      emailVerified: true,
      name: "Expansion tester",
      status: "ACTIVE",
    },
  });
  userIds.push(user.id);
  const store = await prisma.shopifyStore.create({
    data: {
      apiVersion: "2026-07",
      name: "Fake Store",
      organizationId: organization.id,
      shopDomain: `expansion-${prefix}.myshopify.com`,
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
  const file = await uploadFlowFile(
    {
      actorId: user.id,
      body: new TextEncoder().encode(csv),
      contentType: "text/csv",
      fileName: "input.csv",
      organizationId: organization.id,
    },
    storage
  );
  const { flow } = await createFlow({
    actorId: user.id,
    name: "Expansion flow",
    organizationId: organization.id,
  });
  const { validation, version } = await saveFlowVersion(
    { flowId: flow.id, organizationId: organization.id },
    { actorId: user.id, baseVersion: 1, definition }
  );
  expect(validation).toEqual({ issues: [], valid: true });
  const run = await prisma.flowRun.create({
    data: {
      flowId: flow.id,
      flowVersionId: version.id,
      number: 1,
      organizationId: organization.id,
      storeId: store.id,
      triggerPayload: { csvFile: file.id },
      triggerType: "manual",
    },
  });
  return run.id;
};

const dependencies = (
  overrides: Partial<ExecutorDependencies> = {}
): ExecutorDependencies => ({
  readAsset: createAssetReader(storage),
  registry: builtInRegistry,
  ...overrides,
});

const itemsOf = (runId: string, nodeId: string) =>
  prisma.flowRunItem.findMany({
    orderBy: { ordinal: "asc" },
    where: { nodeId, runId },
  });

const runStatus = async (runId: string) =>
  (await prisma.flowRun.findUniqueOrThrow({ where: { id: runId } })).status;

/** Seeds orders and returns a CSV listing them by id. */
const seedOrders = (count: number) => {
  const prefix = randomUUID().slice(0, 8);
  const ids = Array.from(
    { length: count },
    (_, index) => `gid://shopify/Order/${prefix}-${index}`
  );
  for (const id of ids) {
    server.seedOrder({ id, name: id, tags: [], totalPrice: "0" });
  }
  return { csv: `OrderId\n${ids.join("\n")}\n`, ids };
};

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken(STORE_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
});

afterEach(async () => {
  server.setLatency(0);
  server.setBulkPollsUntilComplete(2);
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

describe("routing and shaping nodes", () => {
  it("routes items by switch case, filters them and reshapes their fields", async () => {
    const runId = await createRun(
      {
        edges: [
          edge("trigger", "parse"),
          edge("parse", "shape"),
          edge("shape", "keep"),
          edge("keep", "route"),
          edge("route", "tagVn", "vietnam"),
          edge("route", "tagJp", "japan"),
          edge("route", "tagOther", "default"),
        ],
        nodes: [
          ...csvSource,
          node("shape", "data.setFields", {
            remove: ["Total"],
            rename: [{ from: "Country", to: "country" }],
            set: [
              { name: "total", type: "number", value: "{{ $json.Total }}" },
            ],
          }),
          node("keep", "logic.filter", {
            conditions: [
              {
                left: "{{ $json.total }}",
                operator: "gte",
                right: "100",
                valueType: "number",
              },
            ],
          }),
          node("route", "logic.switch", {
            cases: [
              { name: "vietnam", value: "VN" },
              { name: "japan", value: "JP" },
            ],
            value: "{{ $json.country }}",
          }),
          node("tagVn", "data.setFields", {
            set: [{ name: "region", value: "vn" }],
          }),
          node("tagJp", "data.setFields", {
            set: [{ name: "region", value: "jp" }],
          }),
          node("tagOther", "data.setFields", {
            set: [{ name: "region", value: "other" }],
          }),
        ],
        schemaVersion: 1,
      },
      'Country,Total\nVN,"1,200"\nJP,150\nUS,300\nVN,50\nJP,99.99\nVN,100\n'
    );

    await executeFlowRun(runId, dependencies());

    expect(await runStatus(runId)).toBe("SUCCEEDED");
    // Two rows fall below the filter's threshold and go no further.
    expect(await itemsOf(runId, "keep")).toHaveLength(6);
    expect(await itemsOf(runId, "route")).toHaveLength(4);
    const regions = async (nodeId: string) =>
      (await itemsOf(runId, nodeId)).map(
        ({ output }) =>
          output as { country: string; region: string; total: number }
      );
    expect(await regions("tagVn")).toEqual([
      expect.objectContaining({ country: "VN", region: "vn", total: 1200 }),
      expect.objectContaining({ country: "VN", region: "vn", total: 100 }),
    ]);
    expect(await regions("tagJp")).toEqual([
      expect.objectContaining({ country: "JP", region: "jp", total: 150 }),
    ]);
    expect(await regions("tagOther")).toEqual([
      expect.objectContaining({ country: "US", region: "other", total: 300 }),
    ]);
    expect((await regions("tagVn"))[0]).not.toHaveProperty("Total");
  });
});

describe("generic GraphQL node", () => {
  const graphqlFlow = (): FlowDefinition => ({
    edges: [edge("trigger", "parse"), edge("parse", "mutate")],
    nodes: [
      ...csvSource,
      node("mutate", "shopify.graphql", {
        document: TAG_MUTATION,
        resultPath: "tagsAdd.node",
        variables: '{"id":"{{ $json.OrderId }}","tags":["from-graphql"]}',
      }),
    ],
    schemaVersion: 1,
  });

  it("runs a mutation per item and fails only the item with user errors", async () => {
    const { csv, ids } = seedOrders(3);
    const runId = await createRun(
      graphqlFlow(),
      `${csv}gid://shopify/Order/does-not-exist\n`
    );

    await executeFlowRun(runId, dependencies());

    expect(await runStatus(runId)).toBe("PARTIALLY_FAILED");
    const items = await itemsOf(runId, "mutate");
    expect(items.map(({ status }) => status)).toEqual([
      "SUCCEEDED",
      "SUCCEEDED",
      "SUCCEEDED",
      "FAILED",
    ]);
    expect(items[3]?.error).toMatchObject({
      message: "id: Order does not exist",
    });
    expect(items[0]?.output).toMatchObject({ result: { id: ids[0] } });
    for (const id of ids) {
      expect(server.order(id)?.tags).toEqual(["from-graphql"]);
    }
  });

  it("leaves a mutation interrupted mid-call as unknown and never sends it again", async () => {
    const { csv, ids } = seedOrders(5);
    const runId = await createRun(graphqlFlow(), csv);
    const stop = new AbortController();
    let sent = 0;
    // The process dies after the third mutation was sent, before its answer
    // was recorded.
    const dyingClient: typeof createStoreClient = async (scope, options) => {
      const client = await createStoreClient(scope, options);
      return {
        ...client,
        requestWithRetry: async (request, retryOptions) => {
          sent += 1;
          const pending = client.requestWithRetry(request, {
            ...retryOptions,
            signal: undefined,
          });
          if (sent === 3) {
            await pending;
            stop.abort(new Error("process stopping"));
            throw stop.signal.reason;
          }
          return pending;
        },
      };
    };

    const first = await executeFlowRun(
      runId,
      dependencies({ createStoreClient: dyingClient, signal: stop.signal })
    );
    expect(first).toBe("interrupted");
    const tagRequests = () =>
      server.graphqlRequests.filter(
        ({ query, variables }) =>
          query === TAG_MUTATION && ids.includes(String(variables?.id))
      );
    const sentBeforeResume = tagRequests().length;

    await executeFlowRun(runId, dependencies());

    expect(await runStatus(runId)).toBe("PARTIALLY_FAILED");
    const items = await itemsOf(runId, "mutate");
    const unknown = items.filter(({ status }) => status === "UNKNOWN");
    expect(unknown).toHaveLength(1);
    expect(items.filter(({ status }) => status === "SUCCEEDED")).toHaveLength(
      4
    );
    // Every order was sent exactly once across both executions, including
    // the one whose outcome is unknown.
    const perOrder = ids.map(
      (id) =>
        tagRequests().filter(({ variables }) => variables?.id === id).length
    );
    expect(perOrder).toEqual([1, 1, 1, 1, 1]);
    // The restart sent only what had not been sent yet; the unknown one was
    // not among them.
    expect(sentBeforeResume).toBeGreaterThanOrEqual(3);
    expect(tagRequests()).toHaveLength(5);
  });
});

describe("bulk mutation node", () => {
  const bulkFlow = (): FlowDefinition => ({
    edges: [
      edge("trigger", "parse"),
      edge("parse", "bulk"),
      edge("bulk", "after"),
    ],
    nodes: [
      ...csvSource,
      node("bulk", "shopify.bulkMutation", {
        mutation: TAG_MUTATION,
        pollIntervalSeconds: 1,
        variables: '{"id":"{{ $json.OrderId }}","tags":["bulk"]}',
      }),
      node("after", "data.setFields", {
        set: [{ name: "done", value: "yes" }],
      }),
    ],
    schemaVersion: 1,
  });

  it("submits all items once, waits, and records each item's result", async () => {
    const { csv, ids } = seedOrders(12);
    const before = server.bulkOperations.length;
    const runId = await createRun(
      bulkFlow(),
      `${csv}gid://shopify/Order/missing-in-bulk\n`
    );

    await executeFlowRun(runId, dependencies());

    expect(await runStatus(runId)).toBe("PARTIALLY_FAILED");
    expect(server.bulkOperations).toHaveLength(before + 1);
    expect(server.bulkOperations.at(-1)).toMatchObject({
      lineCount: 13,
      status: "COMPLETED",
    });
    for (const id of ids) {
      expect(server.order(id)?.tags).toEqual(["bulk"]);
    }
    const items = await itemsOf(runId, "bulk");
    expect(items.filter(({ status }) => status === "SUCCEEDED")).toHaveLength(
      12
    );
    const failed = items.filter(({ status }) => status === "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toMatchObject({ message: "Order does not exist" });
    // Results flow on to the next step like any other item.
    expect(await itemsOf(runId, "after")).toHaveLength(12);
  }, 60_000);

  it("resumes waiting after a restart instead of submitting the batch again", async () => {
    const { csv, ids } = seedOrders(8);
    const before = server.bulkOperations.length;
    server.setBulkPollsUntilComplete(4);
    const runId = await createRun(bulkFlow(), csv);
    const stop = new AbortController();
    let requests = 0;
    // Staged upload, start, then the first status check: stop there.
    const stoppingClient: typeof createStoreClient = async (scope, options) => {
      const client = await createStoreClient(scope, options);
      return {
        ...client,
        requestWithRetry: async (request, retryOptions) => {
          const result = await client.requestWithRetry(request, retryOptions);
          requests += 1;
          if (requests === 3) {
            stop.abort(new Error("process stopping"));
          }
          return result;
        },
      };
    };

    const first = await executeFlowRun(
      runId,
      dependencies({ createStoreClient: stoppingClient, signal: stop.signal })
    );

    expect(first).toBe("interrupted");
    expect(server.bulkOperations).toHaveLength(before + 1);
    expect(await runStatus(runId)).toBe("RUNNING");
    const step = await prisma.flowRunStep.findFirstOrThrow({
      where: { nodeId: "bulk", runId },
    });
    expect(step.state).toMatchObject({
      bulkOperation: {
        operationId: server.bulkOperations.at(-1)?.id,
        phase: "submitted",
      },
    });

    await executeFlowRun(runId, dependencies());

    expect(await runStatus(runId)).toBe("SUCCEEDED");
    expect(server.bulkOperations).toHaveLength(before + 1);
    for (const id of ids) {
      expect(server.order(id)?.tags).toEqual(["bulk"]);
    }
    expect((await itemsOf(runId, "bulk")).map(({ status }) => status)).toEqual(
      Array.from({ length: 8 }, () => "SUCCEEDED")
    );
  }, 60_000);

  it("marks every item unknown when it cannot tell whether the batch was submitted", async () => {
    const { csv, ids } = seedOrders(3);
    const before = server.bulkOperations.length;
    const runId = await createRun(bulkFlow(), csv);
    // As left behind by a process that died while starting the operation.
    await prisma.flowRunStep.create({
      data: {
        nodeId: "bulk",
        nodeType: "shopify.bulkMutation",
        runId,
        state: {
          bulkOperation: { keys: ["0.0", "0.1", "0.2"], phase: "submitting" },
        },
      },
    });

    await executeFlowRun(runId, dependencies());

    expect(await runStatus(runId)).toBe("PARTIALLY_FAILED");
    expect(server.bulkOperations).toHaveLength(before);
    const items = await itemsOf(runId, "bulk");
    expect(items.map(({ status }) => status)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(JSON.stringify(items[0]?.error)).toContain("outcome is unknown");
    for (const id of ids) {
      expect(server.order(id)?.tags).toEqual([]);
    }
  });
});
