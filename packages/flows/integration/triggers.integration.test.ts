import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { createLocalJobProvider, type JobQueueProvider } from "@repo/jobs";
import { createPgBossJobProvider } from "@repo/jobs/pg-boss";
import { encryptSecret } from "@repo/shopify/crypto";
import { createApp, saveToken } from "@repo/shopify/stores";
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
import {
  activateFlow,
  builtInRegistry,
  createAssetReader,
  createFlow,
  createFlowRunJob,
  createFlowScheduleJob,
  deactivateFlow,
  type FlowDefinition,
  listActivations,
  receiveWebhookDelivery,
  saveFlowVersion,
} from "../src";

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const STORE_TOKEN = "shpat_trigger_token";
const WEBHOOK_SECRET = "store-webhook-signing-secret";
const APP_SECRET = "app-client-secret-value";
const BASE_URL = "https://toolkit.example.com";

const suiteStartedAt = new Date();
const organizationIds: string[] = [];
const userIds: string[] = [];
const providers: JobQueueProvider[] = [];
let server: FakeShopifyServer;

const node = (id: string, type: string, config: Record<string, unknown>) => ({
  config,
  id,
  name: id,
  position: { x: 0, y: 0 },
  type,
});

const flowWith = (trigger: ReturnType<typeof node>): FlowDefinition => ({
  edges: [
    { id: "e1", source: trigger.id, sourceHandle: "main", target: "tag" },
  ],
  nodes: [
    trigger,
    node("tag", "shopify.addTags", {
      resourceId: "{{ $json.admin_graphql_api_id }}",
      tags: ["from-trigger"],
    }),
  ],
  schemaVersion: 1,
});

const webhookFlow = () =>
  flowWith(node("trigger", "trigger.webhook", { topic: "ORDERS_CREATE" }));

const createWorkspace = async (
  connection: "static" | "static-with-secret" | "app" = "static-with-secret"
) => {
  const prefix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Triggers ${prefix}`, slug: `triggers-${prefix}` },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      email: `triggers-${prefix}@example.com`,
      emailVerified: true,
      name: "Trigger tester",
      status: "ACTIVE",
    },
  });
  userIds.push(user.id);
  const app =
    connection === "app"
      ? await createApp({
          clientId: `client-${prefix}`,
          clientSecret: APP_SECRET,
          name: "App",
          organizationId: organization.id,
          scopes: [],
        })
      : null;
  const store = await prisma.shopifyStore.create({
    data: {
      apiVersion: "2026-07",
      appId: app?.id ?? null,
      name: "Fake Store",
      organizationId: organization.id,
      shopDomain: `triggers-${prefix}.myshopify.com`,
      status: "CONNECTED",
      strategy: app ? "OAUTH" : "STATIC_TOKEN",
      webhookSecretEncrypted:
        connection === "static-with-secret"
          ? encryptSecret(WEBHOOK_SECRET)
          : null,
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
    shopDomain: store.shopDomain,
    storeId: store.id,
    userId: user.id,
  };
};

type Workspace = Awaited<ReturnType<typeof createWorkspace>>;

const saveFlow = async (workspace: Workspace, definition: FlowDefinition) => {
  const { flow } = await createFlow({
    actorId: workspace.userId,
    name: "Triggered flow",
    organizationId: workspace.organizationId,
  });
  const scope = { flowId: flow.id, organizationId: workspace.organizationId };
  await saveFlowVersion(scope, {
    actorId: workspace.userId,
    baseVersion: 1,
    definition,
  });
  return scope;
};

/** A local job provider that runs flow runs in this process. */
const createJobs = () => {
  const jobs = createLocalJobProvider();
  jobs.register(
    createFlowRunJob({
      readAsset: createAssetReader(createMemoryStorageProvider()),
      registry: builtInRegistry,
    })
  );
  providers.push(jobs);
  return jobs;
};

const delivery = (
  workspace: Workspace,
  activationId: string,
  payload: Record<string, unknown>,
  overrides: Partial<{
    body: string;
    deliveryId: string | null;
    secret: string;
    shop: string;
    topic: string;
  }> = {}
) => {
  const body = JSON.stringify(payload);
  return {
    activationId,
    deliveryId:
      overrides.deliveryId === undefined ? randomUUID() : overrides.deliveryId,
    hmacHeader: createHmac("sha256", overrides.secret ?? WEBHOOK_SECRET)
      .update(body)
      .digest("base64"),
    rawBody: new TextEncoder().encode(overrides.body ?? body),
    shopDomainHeader: overrides.shop ?? workspace.shopDomain,
    topicHeader: overrides.topic ?? "orders/create",
  };
};

const runCount = (flowId: string) =>
  prisma.flowRun.count({ where: { flowId } });
const eventCount = (activationId: string) =>
  prisma.webhookEvent.count({
    where: { externalId: { startsWith: `${activationId}:` } },
  });

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken(STORE_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
});

beforeEach(() => {
  process.env.SHOPIFY_WEBHOOK_BASE_URL = BASE_URL;
});

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.stop()));
  // Only the events these tests recorded.
  await prisma.webhookEvent.deleteMany({
    where: { provider: "shopify", receivedAt: { gte: suiteStartedAt } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds.splice(0) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

afterAll(async () => {
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  Reflect.deleteProperty(process.env, "SHOPIFY_WEBHOOK_BASE_URL");
  await server.close();
  await prisma.$disconnect();
});

describe("webhook-triggered flows", () => {
  it("subscribes on activation, and one signed delivery starts exactly one run", async () => {
    const workspace = await createWorkspace();
    const jobs = createJobs();
    const scope = await saveFlow(workspace, webhookFlow());
    const orderId = `gid://shopify/Order/${workspace.prefix}`;
    server.seedOrder({ id: orderId, name: "#1", tags: [], totalPrice: "10" });

    const activation = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );

    expect(activation).toMatchObject({ error: null, status: "ACTIVE" });
    expect(
      server.webhookSubscriptions.get(activation.webhookSubscriptionId ?? "")
    ).toEqual({
      topic: "ORDERS_CREATE",
      uri: `${BASE_URL}/api/webhooks/shopify/${activation.id}`,
    });

    const payload = { admin_graphql_api_id: orderId, id: 1, name: "#1" };
    const first = delivery(workspace, activation.id, payload);
    await expect(
      receiveWebhookDelivery(first, { jobs })
    ).resolves.toMatchObject({
      duplicate: false,
      status: 200,
    });
    // Shopify retries deliveries; the same delivery id starts nothing more.
    await expect(receiveWebhookDelivery(first, { jobs })).resolves.toEqual({
      duplicate: true,
      runId: null,
      status: 200,
    });
    await jobs.waitUntilIdle();

    await expect(runCount(scope.flowId)).resolves.toBe(1);
    const run = await prisma.flowRun.findFirstOrThrow({
      where: { flowId: scope.flowId },
    });
    expect(run).toMatchObject({
      startedById: null,
      status: "SUCCEEDED",
      triggerPayload: payload,
      triggerType: "webhook",
    });
    expect(server.order(orderId)?.tags).toEqual(["from-trigger"]);
  });

  it("answers 401 and writes nothing for a tampered, wrongly signed or misaddressed delivery", async () => {
    const workspace = await createWorkspace();
    const jobs = createJobs();
    const scope = await saveFlow(workspace, webhookFlow());
    const { id } = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );
    const payload = { admin_graphql_api_id: "gid://shopify/Order/1" };
    const refused = [
      delivery(workspace, id, payload, {
        body: '{"admin_graphql_api_id":"x"}',
      }),
      delivery(workspace, id, payload, { secret: "another-secret" }),
      { ...delivery(workspace, id, payload), hmacHeader: null },
      delivery(workspace, id, payload, { shop: "other.myshopify.com" }),
      delivery(workspace, id, payload, { topic: "orders/updated" }),
      delivery(workspace, id, payload, { deliveryId: null }),
    ];

    for (const attempt of refused) {
      await expect(
        receiveWebhookDelivery(attempt, { jobs })
      ).resolves.toMatchObject({
        status: 401,
      });
    }
    await expect(
      receiveWebhookDelivery(
        delivery(workspace, "unknown-activation", payload),
        {
          jobs,
        }
      )
    ).resolves.toMatchObject({ status: 404 });

    await expect(runCount(scope.flowId)).resolves.toBe(0);
    await expect(eventCount(id)).resolves.toBe(0);
  });

  it("verifies with the app's client secret for stores connected through an app", async () => {
    const workspace = await createWorkspace("app");
    const jobs = createJobs();
    const scope = await saveFlow(workspace, webhookFlow());
    const { id, status } = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );
    expect(status).toBe("ACTIVE");
    const payload = { admin_graphql_api_id: "gid://shopify/Order/none" };

    await expect(
      receiveWebhookDelivery(delivery(workspace, id, payload), { jobs })
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      receiveWebhookDelivery(
        delivery(workspace, id, payload, { secret: APP_SECRET }),
        { jobs }
      )
    ).resolves.toMatchObject({ status: 200 });
    await jobs.waitUntilIdle();
  });

  it("stops starting runs and removes the subscription on deactivation", async () => {
    const workspace = await createWorkspace();
    const jobs = createJobs();
    const scope = await saveFlow(workspace, webhookFlow());
    const activation = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );
    const subscriptionId = activation.webhookSubscriptionId ?? "";
    expect(server.webhookSubscriptions.has(subscriptionId)).toBe(true);

    const off = await deactivateFlow(
      scope,
      { storeId: workspace.storeId },
      { jobs }
    );
    expect(off).toMatchObject({
      status: "INACTIVE",
      webhookSubscriptionId: null,
    });
    expect(server.webhookSubscriptions.has(subscriptionId)).toBe(false);
    await expect(
      receiveWebhookDelivery(delivery(workspace, activation.id, { id: 1 }), {
        jobs,
      })
    ).resolves.toMatchObject({ status: 404 });
    await expect(runCount(scope.flowId)).resolves.toBe(0);

    // Deactivating again, and activating again, both work.
    await expect(
      deactivateFlow(scope, { storeId: workspace.storeId }, { jobs })
    ).resolves.toMatchObject({ status: "INACTIVE" });
    const again = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );
    expect(again).toMatchObject({ id: activation.id, status: "ACTIVE" });
    expect(server.webhookSubscriptions.size).toBeGreaterThan(0);
    await expect(listActivations(scope)).resolves.toHaveLength(1);
  });

  it("refuses activation without a signing secret, a public address or a suitable trigger", async () => {
    const jobs = createJobs();
    const withoutSecret = await createWorkspace("static");
    const scope = await saveFlow(withoutSecret, webhookFlow());
    const activate = (target = scope, workspace = withoutSecret) =>
      activateFlow(
        target,
        { actorId: workspace.userId, storeId: workspace.storeId },
        { jobs }
      ).catch((caught: unknown) => caught);

    await expect(activate()).resolves.toMatchObject({
      failure: "ACTIVATION_INVALID",
      message: expect.stringContaining("webhook signing secret"),
    });

    const ready = await createWorkspace();
    const readyScope = await saveFlow(ready, webhookFlow());
    Reflect.deleteProperty(process.env, "SHOPIFY_WEBHOOK_BASE_URL");
    await expect(activate(readyScope, ready)).resolves.toMatchObject({
      failure: "ACTIVATION_INVALID",
      message: expect.stringContaining("SHOPIFY_WEBHOOK_BASE_URL"),
    });

    const manual = await saveFlow(
      ready,
      flowWith(node("trigger", "trigger.manual", { inputs: [] }))
    );
    await expect(activate(manual, ready)).resolves.toMatchObject({
      failure: "ACTIVATION_INVALID",
    });
    const invalid = await saveFlow(
      ready,
      flowWith(node("trigger", "trigger.schedule", { cron: "every day" }))
    );
    await expect(activate(invalid, ready)).resolves.toMatchObject({
      failure: "FLOW_INVALID",
    });
    // Counted for these workspaces only; other suites share the database.
    await expect(
      prisma.flowActivation.count({
        where: {
          flow: {
            organizationId: {
              in: [withoutSecret.organizationId, ready.organizationId],
            },
          },
        },
      })
    ).resolves.toBe(0);
  });

  it("keeps the reason when Shopify refuses the subscription", async () => {
    const workspace = await createWorkspace();
    const jobs = createJobs();
    const scope = await saveFlow(workspace, webhookFlow());
    process.env.SHOPIFY_WEBHOOK_BASE_URL = "ftp://unreachable.example.com";

    const activation = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );

    expect(activation.status).toBe("FAILED");
    expect(activation.error).toContain("Address is invalid");
    await expect(
      receiveWebhookDelivery(delivery(workspace, activation.id, { id: 1 }), {
        jobs,
      })
    ).resolves.toMatchObject({ status: 404 });
  });
});

describe("scheduled flows", () => {
  const scheduleFlow = () =>
    flowWith(
      node("trigger", "trigger.schedule", {
        cron: "* * * * *",
        timezone: "Asia/Ho_Chi_Minh",
      })
    );

  it("starts a run when the schedule fires, and none after deactivation", async () => {
    const workspace = await createWorkspace();
    const schema = `pgboss_triggers_${workspace.prefix}`;
    const jobs = createPgBossJobProvider({
      connectionString: process.env.DATABASE_URL as string,
      pollingIntervalSeconds: 0.5,
      schema,
    });
    providers.push(jobs);
    jobs.register(
      createFlowRunJob({
        readAsset: createAssetReader(createMemoryStorageProvider()),
        registry: builtInRegistry,
      })
    );
    jobs.register(createFlowScheduleJob(jobs));
    await jobs.start();
    const scope = await saveFlow(workspace, scheduleFlow());

    const activation = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );
    expect(activation).toMatchObject({
      error: null,
      status: "ACTIVE",
      webhookSubscriptionId: null,
    });

    const deadline = Date.now() + 130_000;
    while ((await runCount(scope.flowId)) === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const run = await prisma.flowRun.findFirstOrThrow({
      where: { flowId: scope.flowId },
    });
    expect(run.triggerType).toBe("schedule");
    expect(run.triggerPayload).toMatchObject({
      scheduledAt: expect.any(String),
    });

    await expect(
      deactivateFlow(scope, { storeId: workspace.storeId }, { jobs })
    ).resolves.toMatchObject({ error: null, status: "INACTIVE" });
    await jobs.waitUntilIdle();
    const afterDeactivation = await runCount(scope.flowId);
    // Longer than one schedule period: nothing new may start.
    await new Promise((resolve) => setTimeout(resolve, 75_000));
    await expect(runCount(scope.flowId)).resolves.toBe(afterDeactivation);

    await jobs.stop();
    providers.length = 0;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }, 300_000);

  it("records why activation failed when schedules are not available", async () => {
    const workspace = await createWorkspace();
    const jobs = createJobs();
    const scope = await saveFlow(workspace, scheduleFlow());

    const activation = await activateFlow(
      scope,
      { actorId: workspace.userId, storeId: workspace.storeId },
      { jobs }
    );

    expect(activation.status).toBe("FAILED");
    expect(activation.error).toContain(
      "not supported by the local job provider"
    );
  });
});
