import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import {
  type FakeShopifyServer,
  startFakeShopifyServer,
} from "@repo/shopify/testing";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApiApp } from "../src/app";
import { getJobProvider, registerJobs } from "../src/jobs";
import { createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";
process.env.JOBS_PROVIDER = "local";
process.env.SHOPIFY_WEBHOOK_BASE_URL = "https://toolkit.example.com";

const STORE_TOKEN = "shpat_trigger_api_token";
const WEBHOOK_SECRET = "store-webhook-signing-secret";

const { call, cleanup, createActor, createOrganization, responseBodies } =
  createApiHarness();
const app = createApiApp();
const suiteStartedAt = new Date();
let server: FakeShopifyServer;

const webhookFlow = {
  edges: [{ id: "e1", source: "trigger", sourceHandle: "main", target: "tag" }],
  nodes: [
    {
      config: { topic: "ORDERS_CREATE" },
      id: "trigger",
      name: "On order",
      position: { x: 0, y: 0 },
      type: "trigger.webhook",
    },
    {
      config: {
        resourceId: "{{ $json.admin_graphql_api_id }}",
        tags: ["from-webhook"],
      },
      id: "tag",
      name: "Tag",
      position: { x: 260, y: 0 },
      type: "shopify.addTags",
    },
  ],
  schemaVersion: 1,
};

/** Sends a delivery the way Shopify does: no session, a signed raw body. */
const deliver = (
  activationId: string,
  body: string,
  headers: Record<string, string>
) =>
  app.request(`/api/webhooks/shopify/${activationId}`, {
    body,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

const signed = (body: string, shopDomain: string, secret = WEBHOOK_SECRET) => ({
  "x-shopify-hmac-sha256": createHmac("sha256", secret)
    .update(body)
    .digest("base64"),
  "x-shopify-shop-domain": shopDomain,
  "x-shopify-topic": "orders/create",
  "x-shopify-webhook-id": randomUUID(),
});

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken(STORE_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
  const jobs = getJobProvider();
  registerJobs(jobs);
  await jobs.start();
});

afterEach(async () => {
  await prisma.webhookEvent.deleteMany({
    where: { provider: "shopify", receivedAt: { gte: suiteStartedAt } },
  });
  await cleanup();
});

afterAll(async () => {
  await getJobProvider().stop();
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  Reflect.deleteProperty(process.env, "SHOPIFY_WEBHOOK_BASE_URL");
  await server.close();
  await prisma.$disconnect();
});

describe("webhook-triggered flows through the API", () => {
  it("activates a flow and runs it for a signed delivery only", async () => {
    const organization = await createOrganization();
    const owner = await createActor("Owner", organization);
    const member = await createActor("Member", organization);
    const outsider = await createActor("Owner");
    const connected = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/stores/static-token`,
      {
        accessToken: STORE_TOKEN,
        shopDomain: `hooks-${randomUUID()}.myshopify.com`,
      }
    );
    const storeId = connected.json.data.id as string;
    const shopDomain = connected.json.data.shopDomain as string;
    const created = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/flows`,
      { name: "Tag new orders" }
    );
    const flowId = created.json.data.flow.id as string;
    const saved = await call(owner, "POST", `/api/flows/${flowId}/versions`, {
      baseVersion: 1,
      definition: webhookFlow,
    });
    expect(saved.json.data.validation.valid).toBe(true);
    const activations = `/api/flows/${flowId}/activations`;

    // A store connected by a pasted token needs its signing secret first.
    const early = await call(owner, "POST", activations, { storeId });
    expect(early.status).toBe(422);
    expect(early.json.error.details.reason).toBe("ACTIVATION_INVALID");

    const secretPath = `/api/shopify/stores/${storeId}/webhook-secret`;
    expect(
      (await call(member, "PUT", secretPath, { secret: WEBHOOK_SECRET })).status
    ).toBe(403);
    const withSecret = await call(owner, "PUT", secretPath, {
      secret: WEBHOOK_SECRET,
    });
    expect(withSecret.json.data.hasWebhookSecret).toBe(true);

    expect((await call(member, "POST", activations, { storeId })).status).toBe(
      403
    );
    expect(
      (await call(outsider, "POST", activations, { storeId })).status
    ).toBe(404);
    const activated = await call(owner, "POST", activations, { storeId });
    expect(activated.json.data).toMatchObject({
      error: null,
      status: "ACTIVE",
      storeName: "Fake Store",
    });
    const activationId = activated.json.data.id as string;
    expect((await call(member, "GET", activations)).json.data).toHaveLength(1);

    // A manual run of a webhook flow is refused.
    const manual = await call(owner, "POST", `/api/flows/${flowId}/runs`, {
      storeId,
    });
    expect(manual.status).toBe(422);

    const orderId = `gid://shopify/Order/${randomUUID()}`;
    server.seedOrder({ id: orderId, name: "#W1", tags: [], totalPrice: "5" });
    const body = JSON.stringify({ admin_graphql_api_id: orderId, id: 7 });

    const unsigned = await deliver(activationId, body, {
      "x-shopify-shop-domain": shopDomain,
      "x-shopify-topic": "orders/create",
      "x-shopify-webhook-id": randomUUID(),
    });
    const forged = await deliver(
      activationId,
      body,
      signed(body, shopDomain, "guessed-secret")
    );
    expect([unsigned.status, forged.status]).toEqual([401, 401]);
    expect(await unsigned.text()).toBe("");
    await expect(prisma.flowRun.count({ where: { flowId } })).resolves.toBe(0);
    await expect(
      prisma.webhookEvent.count({
        where: { externalId: { startsWith: `${activationId}:` } },
      })
    ).resolves.toBe(0);

    const headers = signed(body, shopDomain);
    const accepted = await deliver(activationId, body, headers);
    const repeated = await deliver(activationId, body, headers);
    expect([accepted.status, repeated.status]).toEqual([200, 200]);
    await getJobProvider().waitUntilIdle();
    await expect(prisma.flowRun.count({ where: { flowId } })).resolves.toBe(1);
    expect(server.order(orderId)?.tags).toEqual(["from-webhook"]);

    const tooLarge = await deliver(
      activationId,
      "x".repeat(5_000_001),
      headers
    );
    expect(tooLarge.status).toBe(413);
    expect((await deliver("missing", body, headers)).status).toBe(404);

    const off = await call(owner, "DELETE", `${activations}/${storeId}`);
    expect(off.json.data).toMatchObject({ status: "INACTIVE" });
    expect(
      (await deliver(activationId, body, signed(body, shopDomain))).status
    ).toBe(404);

    // Disconnecting a store turns its activations off first.
    await call(owner, "POST", activations, { storeId });
    const subscriptions = server.webhookSubscriptions.size;
    await call(owner, "DELETE", `/api/shopify/stores/${storeId}`);
    expect(server.webhookSubscriptions.size).toBe(subscriptions - 1);
    const after = await call(owner, "GET", activations);
    expect(after.json.data[0]).toMatchObject({ status: "INACTIVE" });

    expect(
      responseBodies.filter(
        (text) => text.includes(WEBHOOK_SECRET) || text.includes(STORE_TOKEN)
      )
    ).toEqual([]);
  });
});
