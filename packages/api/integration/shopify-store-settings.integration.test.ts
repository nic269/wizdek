import { randomUUID } from "node:crypto";
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
import { type Actor, createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const CLIENT_ID = "fake-client-id";
const CLIENT_SECRET = "fake-client-secret-value";
const STATIC_TOKEN = "shpat_static_token_value";
const REPLACEMENT_TOKEN = "shpat_replacement_token_value";
const WEBHOOK_SECRET = "webhook-signing-secret-value";
const ISSUED_TOKEN_PATTERN = /^shpat_fake_/;

const { call, cleanup, createActor, createOrganization } = createApiHarness();
let server: FakeShopifyServer;

const shop = () => `store-${randomUUID()}.myshopify.com`;

const connectStatic = async (actor: Actor, shopDomain = shop()) => {
  const response = await call(
    actor,
    "POST",
    `/api/organizations/${actor.organizationId}/shopify/stores/static-token`,
    { accessToken: STATIC_TOKEN, shopDomain }
  );
  expect(response.status).toBe(201);
  return response.json.data as { id: string; shopDomain: string };
};

const storePath = (storeId: string) => `/api/shopify/stores/${storeId}`;

const reveal = (actor: Actor, storeId: string, secret: string) =>
  call(actor, "POST", `${storePath(storeId)}/secrets/reveal`, { secret });

const auditCount = (action: string, targetId: string) =>
  prisma.auditLog.count({ where: { action, targetId } });

beforeAll(async () => {
  server = await startFakeShopifyServer({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  });
  server.acceptToken(STATIC_TOKEN);
  server.acceptToken(REPLACEMENT_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
});

afterEach(cleanup);

afterAll(async () => {
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  await server.close();
  await prisma.$disconnect();
});

describe("renaming a store", () => {
  it("keeps a chosen name through health checks and reconnects until reset", async () => {
    const owner = await createActor("Owner");
    const store = await connectStatic(owner);

    const renamed = await call(owner, "PATCH", storePath(store.id), {
      name: "  EVISU production  ",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json.data).toMatchObject({
      name: "EVISU production",
      nameCustomized: true,
    });

    await call(owner, "POST", `${storePath(store.id)}/health-check`);
    await connectStatic(owner, store.shopDomain);
    const kept = await call(owner, "GET", storePath(store.id));
    expect(kept.json.data.name).toBe("EVISU production");

    const reset = await call(owner, "PATCH", storePath(store.id), {
      name: null,
    });
    expect(reset.json.data).toMatchObject({
      name: "Fake Store",
      nameCustomized: false,
    });
    await expect(auditCount("shopify.store.renamed", store.id)).resolves.toBe(
      2
    );
  });

  it("still changes the environment on its own", async () => {
    const owner = await createActor("Owner");
    const store = await connectStatic(owner);

    const response = await call(owner, "PATCH", storePath(store.id), {
      environment: "PROD",
    });

    expect(response.json.data).toMatchObject({
      environment: "PROD",
      name: "Fake Store",
      nameCustomized: false,
    });
  });
});

describe("changing a store's credentials", () => {
  it("replaces the token after Shopify accepts it and revokes the old one", async () => {
    const owner = await createActor("Owner");
    const store = await connectStatic(owner);

    const response = await call(
      owner,
      "PUT",
      `${storePath(store.id)}/credentials`,
      { accessToken: REPLACEMENT_TOKEN }
    );

    expect(response.status).toBe(200);
    expect(response.json.data.status).toBe("CONNECTED");
    await expect(
      prisma.shopifyToken.count({
        where: { revokedAt: null, rotatedAt: null, storeId: store.id },
      })
    ).resolves.toBe(1);
    const copied = await reveal(owner, store.id, "accessToken");
    expect(copied.json.data.value).toBe(REPLACEMENT_TOKEN);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "shopify.store.credentials_updated",
        targetId: store.id,
      },
    });
    expect(audit.metadata).toEqual({
      shopDomain: store.shopDomain,
      tokenReplaced: true,
    });
  });

  it("saves nothing when Shopify refuses the new token", async () => {
    const owner = await createActor("Owner");
    const store = await connectStatic(owner);

    const response = await call(
      owner,
      "PUT",
      `${storePath(store.id)}/credentials`,
      { accessToken: "shpat_unknown_token_value", shopDomain: shop() }
    );

    expect(response.status).toBe(422);
    const copied = await reveal(owner, store.id, "accessToken");
    expect(copied.json.data.value).toBe(STATIC_TOKEN);
    await expect(
      prisma.shopifyStore.findUniqueOrThrow({ where: { id: store.id } })
    ).resolves.toMatchObject({ shopDomain: store.shopDomain });
  });

  it("moves the store to a new domain with its current token", async () => {
    const owner = await createActor("Owner");
    const store = await connectStatic(owner);
    const shopDomain = shop();

    const response = await call(
      owner,
      "PUT",
      `${storePath(store.id)}/credentials`,
      { shopDomain: shopDomain.toUpperCase() }
    );

    expect(response.status).toBe(200);
    expect(response.json.data).toMatchObject({ id: store.id, shopDomain });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "shopify.store.credentials_updated",
        targetId: store.id,
      },
    });
    expect(audit.metadata).toEqual({
      previousShopDomain: store.shopDomain,
      shopDomain,
      tokenReplaced: false,
    });
  });

  it("refuses a domain another store uses, or one with activated flows", async () => {
    const organization = await createOrganization();
    const owner = await createActor("Owner", organization);
    const first = await connectStatic(owner);
    const second = await connectStatic(owner);

    const taken = await call(
      owner,
      "PUT",
      `${storePath(second.id)}/credentials`,
      { shopDomain: first.shopDomain }
    );
    expect(taken.status).toBe(409);
    expect(taken.json.error.details.reason).toBe("DOMAIN_TAKEN");

    const flow = await prisma.flow.create({
      data: { name: "Order tagger", organizationId: owner.organizationId },
    });
    const version = await prisma.flowVersion.create({
      data: { definition: {}, flowId: flow.id, version: 1 },
    });
    await prisma.flowActivation.create({
      data: {
        flowId: flow.id,
        flowVersionId: version.id,
        status: "ACTIVE",
        storeId: second.id,
      },
    });
    const inUse = await call(
      owner,
      "PUT",
      `${storePath(second.id)}/credentials`,
      { shopDomain: shop() }
    );
    expect(inUse.status).toBe(409);
    expect(inUse.json.error.details.reason).toBe("STORE_IN_USE");
  });

  it("refuses stores whose token the toolkit obtains itself", async () => {
    const owner = await createActor("Owner");
    const app = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/apps`,
      {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        name: "Toolkit app",
        scopes: ["read_orders"],
      }
    );
    const connected = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/stores/client-credentials`,
      { appId: app.json.data.id, shopDomains: [shop()] }
    );
    const storeId = connected.json.data[0].store.id as string;

    const response = await call(
      owner,
      "PUT",
      `${storePath(storeId)}/credentials`,
      { accessToken: REPLACEMENT_TOKEN }
    );

    expect(response.status).toBe(409);
    const copied = await reveal(owner, storeId, "accessToken");
    expect(copied.status).toBe(200);
    expect(copied.json.data.value).toMatch(ISSUED_TOKEN_PATTERN);
    const webhook = await reveal(owner, storeId, "webhookSecret");
    expect(webhook.status).toBe(404);
  });
});

describe("copying a store's secrets", () => {
  it("returns the token and webhook secret to managers and audits each copy", async () => {
    const owner = await createActor("Owner");
    const store = await connectStatic(owner);

    const missing = await reveal(owner, store.id, "webhookSecret");
    expect(missing.status).toBe(404);

    await call(owner, "PUT", `${storePath(store.id)}/webhook-secret`, {
      secret: WEBHOOK_SECRET,
    });
    const token = await reveal(owner, store.id, "accessToken");
    const webhook = await reveal(owner, store.id, "webhookSecret");

    expect(token.json.data.value).toBe(STATIC_TOKEN);
    expect(webhook.json.data.value).toBe(WEBHOOK_SECRET);
    const audits = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      where: { action: "shopify.store.secret_revealed", targetId: store.id },
    });
    expect(audits.map(({ metadata }) => metadata)).toEqual([
      { secret: "accessToken" },
      { secret: "webhookSecret" },
    ]);
    for (const audit of audits) {
      expect(JSON.stringify(audit)).not.toContain(STATIC_TOKEN);
      expect(JSON.stringify(audit)).not.toContain(WEBHOOK_SECRET);
    }
  });

  it("answers 403 to members and 404 to other organizations", async () => {
    const organization = await createOrganization();
    const owner = await createActor("Owner", organization);
    const member = await createActor("Member", organization);
    const outsider = await createActor("Owner");
    const store = await connectStatic(owner);

    const responses = [
      await reveal(member, store.id, "accessToken"),
      await call(member, "PATCH", storePath(store.id), { name: "Mine" }),
      await call(member, "PUT", `${storePath(store.id)}/credentials`, {
        accessToken: REPLACEMENT_TOKEN,
      }),
      await reveal(outsider, store.id, "accessToken"),
      await call(outsider, "PUT", `${storePath(store.id)}/credentials`, {
        accessToken: REPLACEMENT_TOKEN,
      }),
    ];

    expect(responses.map(({ status }) => status)).toEqual([
      403, 403, 403, 404, 404,
    ]);
    await expect(
      auditCount("shopify.store.secret_revealed", store.id)
    ).resolves.toBe(0);
  });
});
