import { createHmac, randomUUID } from "node:crypto";
import { getCurrentSession } from "@repo/auth/session";
import { prisma, syncSystemRoles } from "@repo/database";
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

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const CLIENT_ID = "fake-client-id";
const CLIENT_SECRET = "fake-client-secret-value";
const STATIC_TOKEN = "shpat_static_token_value";
const SECRET_MARKERS = [
  CLIENT_SECRET,
  STATIC_TOKEN,
  "shpat_fake_",
  "shprt_fake_",
];

const organizationIds: string[] = [];
const userIds: string[] = [];
const responseBodies: string[] = [];
const app = createApiApp();
let server: FakeShopifyServer;

interface Actor {
  organizationId: string;
  userId: string;
}

const createUser = async (label: string) => {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${randomUUID()}@example.com`,
      emailVerified: true,
      name: label,
      status: "ACTIVE",
    },
  });
  userIds.push(user.id);
  return user.id;
};

const createOrganization = async () => {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Stores ${suffix}`, slug: `stores-${suffix}` },
  });
  organizationIds.push(organization.id);
  const roles = await prisma.$transaction((transaction) =>
    syncSystemRoles(transaction, organization.id)
  );
  return { organizationId: organization.id, roles };
};

const createActor = async (
  role: "Owner" | "Member" | "Viewer",
  existing?: Awaited<ReturnType<typeof createOrganization>>
): Promise<Actor> => {
  const { organizationId, roles } = existing ?? (await createOrganization());
  const userId = await createUser(role.toLowerCase());
  await prisma.membership.create({
    data: { organizationId, roleId: roles[role].id, userId },
  });
  return { organizationId, userId };
};

const call = async (
  actor: Pick<Actor, "userId"> | null,
  method: string,
  path: string,
  body?: unknown
) => {
  vi.mocked(getCurrentSession).mockResolvedValue(
    actor ? ({ user: { id: actor.userId } } as never) : null
  );
  const response = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
  const text = await response.text();
  responseBodies.push(text);
  return {
    json: (text ? JSON.parse(text) : null) as any,
    status: response.status,
  };
};

const shop = () => `store-${randomUUID()}.myshopify.com`;

const registerApp = async (
  owner: Actor,
  tokenMode: "NON_EXPIRING" | "EXPIRING" = "NON_EXPIRING"
) => {
  const response = await call(
    owner,
    "POST",
    `/api/organizations/${owner.organizationId}/shopify/apps`,
    {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      name: "Toolkit app",
      scopes: ["read_orders", "write_orders"],
      tokenMode,
    }
  );
  expect(response.status).toBe(201);
  return response.json.data.id as string;
};

const connectStatic = (actor: Actor, shopDomain = shop()) =>
  call(
    actor,
    "POST",
    `/api/organizations/${actor.organizationId}/shopify/stores/static-token`,
    { accessToken: STATIC_TOKEN, shopDomain }
  );

const signedCallback = (
  params: Record<string, string>,
  secret = CLIENT_SECRET
) => {
  const query = new URLSearchParams({ timestamp: "1700000000", ...params });
  const message = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  query.set("hmac", createHmac("sha256", secret).update(message).digest("hex"));
  return query.toString();
};

const beginOAuth = async (owner: Actor, appId: string, shopDomain = shop()) => {
  const response = await call(
    owner,
    "POST",
    `/api/organizations/${owner.organizationId}/shopify/stores/oauth`,
    { appId, shopDomain }
  );
  expect(response.status).toBe(201);
  const state = new URL(response.json.data.authorizeUrl).searchParams.get(
    "state"
  ) as string;
  return { data: response.json.data, shopDomain, state };
};

const completeOAuth = (actor: Actor, query: string, storeId?: string) =>
  call(actor, "POST", "/api/shopify/oauth/complete", { query, storeId });

const outboundRequests = () =>
  server.tokenRequests.length + server.graphqlRequests.length;

beforeAll(async () => {
  server = await startFakeShopifyServer({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  });
  server.acceptToken(STATIC_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
});

afterEach(async () => {
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

describe("connecting stores", () => {
  it("connects by static token and stores the shop name", async () => {
    const owner = await createActor("Owner");
    const shopDomain = shop();

    const response = await connectStatic(owner, shopDomain);

    expect(response.status).toBe(201);
    expect(response.json.data).toMatchObject({
      name: "Fake Store",
      scopes: ["read_orders", "write_orders"],
      shopDomain,
      status: "CONNECTED",
      strategy: "STATIC_TOKEN",
    });
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "shopify.store.connected",
        targetId: response.json.data.id,
      },
    });
    expect(audit).toMatchObject({
      actorId: owner.userId,
      organizationId: owner.organizationId,
    });
    expect(JSON.stringify(audit)).not.toContain(STATIC_TOKEN);
  });

  it("rejects a token Shopify does not accept and saves nothing", async () => {
    const owner = await createActor("Owner");
    const shopDomain = shop();

    const response = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/stores/static-token`,
      { accessToken: "shpat_wrong_token", shopDomain }
    );

    expect(response.status).toBe(422);
    expect(response.json.error.details.reason).toBe("CREDENTIALS_REJECTED");
    await expect(
      prisma.shopifyStore.count({
        where: { organizationId: owner.organizationId },
      })
    ).resolves.toBe(0);
  });

  it("connects several stores by client credentials with a result each", async () => {
    const owner = await createActor("Owner");
    const appId = await registerApp(owner);
    const shopDomains = [shop(), shop(), shop()];

    const response = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/stores/client-credentials`,
      { appId, shopDomains }
    );

    expect(response.status).toBe(200);
    expect(response.json.data).toHaveLength(3);
    for (const result of response.json.data) {
      expect(result).toMatchObject({
        error: null,
        ok: true,
        store: {
          appId,
          name: "Fake Store",
          status: "CONNECTED",
          strategy: "CLIENT_CREDENTIALS",
        },
      });
    }

    const tooMany = await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/stores/client-credentials`,
      { appId, shopDomains: Array.from({ length: 11 }, shop) }
    );
    expect(tooMany.status).toBe(422);
  });

  it("connects by OAuth with an expiring token and consumes the state", async () => {
    const owner = await createActor("Owner");
    const appId = await registerApp(owner, "EXPIRING");
    const { data, shopDomain, state } = await beginOAuth(owner, appId);

    expect(data.store.status).toBe("PENDING");
    expect(new URL(data.redirectUrl).pathname).toBe(
      "/api/shopify/oauth/callback"
    );
    const authorize = new URL(data.authorizeUrl);
    expect(authorize.origin).toBe(`https://${shopDomain}`);
    expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(authorize.searchParams.get("redirect_uri")).toBe(data.redirectUrl);
    const storedState = await prisma.shopifyOAuthState.findFirstOrThrow({
      where: { storeId: data.store.id },
    });
    expect(storedState.stateHash).not.toBe(state);

    const query = signedCallback({
      code: "install-code",
      shop: shopDomain,
      state,
    });
    const completed = await completeOAuth(owner, query);

    expect(completed.status).toBe(200);
    expect(completed.json.data).toMatchObject({
      id: data.store.id,
      name: "Fake Store",
      status: "CONNECTED",
      strategy: "OAUTH",
    });
    const token = await prisma.shopifyToken.findFirstOrThrow({
      where: { revokedAt: null, storeId: data.store.id },
    });
    expect(token.refreshTokenEncrypted).not.toBeNull();
    expect(token.accessTokenExpiresAt).toBeInstanceOf(Date);
    expect(server.tokenRequests.at(-1)?.params.expiring).toBe("1");

    const replayed = await completeOAuth(owner, query);
    expect(replayed.status).toBe(422);
    expect(replayed.json.error.details.reason).toBe("OAUTH_STATE_INVALID");
  });

  it("rejects an expired state, a tampered signature and another user's state", async () => {
    const organization = await createOrganization();
    const owner = await createActor("Owner", organization);
    const secondOwner = await createActor("Owner", organization);
    const appId = await registerApp(owner);

    const expired = await beginOAuth(owner, appId);
    await prisma.shopifyOAuthState.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { storeId: expired.data.store.id },
    });
    const expiredResponse = await completeOAuth(
      owner,
      signedCallback({
        code: "c",
        shop: expired.shopDomain,
        state: expired.state,
      })
    );
    expect(expiredResponse.status).toBe(422);
    expect(expiredResponse.json.error.details.reason).toBe(
      "OAUTH_STATE_INVALID"
    );

    const tampered = await beginOAuth(owner, appId);
    const before = server.tokenRequests.length;
    const tamperedResponse = await completeOAuth(
      owner,
      signedCallback(
        { code: "c", shop: tampered.shopDomain, state: tampered.state },
        "not-the-client-secret"
      )
    );
    expect(tamperedResponse.status).toBe(422);
    expect(tamperedResponse.json.error.details.reason).toBe(
      "OAUTH_SIGNATURE_INVALID"
    );
    expect(server.tokenRequests).toHaveLength(before);

    const foreignResponse = await completeOAuth(
      secondOwner,
      signedCallback({
        code: "c",
        shop: tampered.shopDomain,
        state: tampered.state,
      })
    );
    expect(foreignResponse.status).toBe(422);
    expect(foreignResponse.json.error.details.reason).toBe(
      "OAUTH_STATE_INVALID"
    );

    await expect(
      prisma.shopifyStore.findUniqueOrThrow({
        where: { id: tampered.data.store.id },
      })
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("completes a stateless callback for the single pending store", async () => {
    const owner = await createActor("Owner");
    const appId = await registerApp(owner);
    const { data, shopDomain } = await beginOAuth(owner, appId);

    const completed = await completeOAuth(
      owner,
      signedCallback({ code: "managed-install", shop: shopDomain })
    );

    expect(completed.status).toBe(200);
    expect(completed.json.data).toMatchObject({
      id: data.store.id,
      status: "CONNECTED",
    });
  });

  it("rejects an invalid domain with 422 before any outbound request", async () => {
    const owner = await createActor("Owner");
    const appId = await registerApp(owner);
    const base = `/api/organizations/${owner.organizationId}/shopify/stores`;
    const before = outboundRequests();

    for (const shopDomain of ["evil.com", "a.myshopify.com.evil.com"]) {
      const responses = await Promise.all([
        call(owner, "POST", `${base}/static-token`, {
          accessToken: STATIC_TOKEN,
          shopDomain,
        }),
        call(owner, "POST", `${base}/client-credentials`, {
          appId,
          shopDomains: [shopDomain],
        }),
        call(owner, "POST", `${base}/oauth`, { appId, shopDomain }),
      ]);
      expect(responses.map(({ status }) => status)).toEqual([422, 422, 422]);
    }
    const badCallback = await completeOAuth(
      owner,
      signedCallback({ code: "c", shop: "evil.com" })
    );
    expect(badCallback.status).toBe(422);
    expect(outboundRequests()).toBe(before);
  });
});

describe("store access control", () => {
  it("requires a session", async () => {
    const owner = await createActor("Owner");
    const response = await call(
      null,
      "GET",
      `/api/organizations/${owner.organizationId}/shopify/stores`
    );
    expect(response.status).toBe(401);
  });

  it("lets a member read but answers 403 on every write", async () => {
    const organization = await createOrganization();
    const owner = await createActor("Owner", organization);
    const member = await createActor("Member", organization);
    const appId = await registerApp(owner);
    const store = (await connectStatic(owner)).json.data;
    const pending = await beginOAuth(owner, appId);
    const base = `/api/organizations/${member.organizationId}/shopify`;

    const reads = await Promise.all([
      call(member, "GET", `${base}/stores`),
      call(member, "GET", `${base}/apps`),
      call(member, "GET", `/api/shopify/stores/${store.id}`),
      call(member, "POST", `/api/shopify/stores/${store.id}/health-check`),
    ]);
    expect(reads.map(({ status }) => status)).toEqual([200, 200, 200, 200]);

    const writes = [
      await call(member, "POST", `${base}/apps`, {
        clientId: "another-client-id",
        clientSecret: CLIENT_SECRET,
        name: "Member app",
      }),
      await call(member, "PATCH", `${base}/apps/${appId}`, { name: "Renamed" }),
      await call(member, "DELETE", `${base}/apps/${appId}`),
      await connectStatic(member),
      await call(member, "POST", `${base}/stores/client-credentials`, {
        appId,
        shopDomains: [shop()],
      }),
      await call(member, "POST", `${base}/stores/oauth`, {
        appId,
        shopDomain: shop(),
      }),
      await call(member, "DELETE", `/api/shopify/stores/${store.id}`),
    ];
    expect(writes.map(({ status }) => status)).toEqual([
      403, 403, 403, 403, 403, 403, 403,
    ]);

    // Completing someone else's install is refused as well, by either route in.
    const viaStoreId = await completeOAuth(
      member,
      signedCallback({ code: "c", shop: pending.shopDomain }),
      pending.data.store.id
    );
    expect(viaStoreId.status).toBe(404);
    await expect(
      prisma.shopifyStore.findUniqueOrThrow({
        where: { id: pending.data.store.id },
      })
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(
      prisma.shopifyStore.findUniqueOrThrow({ where: { id: store.id } })
    ).resolves.toMatchObject({ status: "CONNECTED" });
  });

  it("answers 404 to a user from another organization", async () => {
    const owner = await createActor("Owner");
    const outsider = await createActor("Owner");
    const store = (await connectStatic(owner)).json.data;

    const responses = await Promise.all([
      call(outsider, "GET", `/api/shopify/stores/${store.id}`),
      call(outsider, "POST", `/api/shopify/stores/${store.id}/health-check`),
      call(outsider, "DELETE", `/api/shopify/stores/${store.id}`),
      call(outsider, "GET", "/api/shopify/stores/does-not-exist"),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404]);

    const foreignList = await call(
      outsider,
      "GET",
      `/api/organizations/${owner.organizationId}/shopify/stores`
    );
    expect(foreignList.status).toBe(403);
    const ownList = await call(
      outsider,
      "GET",
      `/api/organizations/${outsider.organizationId}/shopify/stores`
    );
    expect(ownList.json.data).toEqual([]);
  });
});

describe("store lifecycle", () => {
  it("marks a store reconnect-required after a 401 and recovers on reconnect", async () => {
    const owner = await createActor("Owner");
    const shopDomain = shop();
    const store = (await connectStatic(owner, shopDomain)).json.data;

    server.failNextWithUnauthorized();
    const failed = await call(
      owner,
      "POST",
      `/api/shopify/stores/${store.id}/health-check`
    );

    expect(failed.status).toBe(200);
    expect(failed.json.data).toMatchObject({
      ok: false,
      store: { status: "RECONNECT_REQUIRED" },
    });
    expect(failed.json.data.store.lastHealthCheckError).toBeTruthy();

    const reconnected = await connectStatic(owner, shopDomain);
    expect(reconnected.json.data).toMatchObject({
      id: store.id,
      status: "CONNECTED",
    });
    await expect(
      prisma.shopifyToken.count({
        where: { revokedAt: null, storeId: store.id },
      })
    ).resolves.toBe(1);
  });

  it("disconnects a store by deleting its tokens", async () => {
    const owner = await createActor("Owner");
    const store = (await connectStatic(owner)).json.data;

    const response = await call(
      owner,
      "DELETE",
      `/api/shopify/stores/${store.id}`
    );

    expect(response.status).toBe(200);
    expect(response.json.data.status).toBe("DISCONNECTED");
    await expect(
      prisma.shopifyToken.count({ where: { storeId: store.id } })
    ).resolves.toBe(0);
    const check = await call(
      owner,
      "POST",
      `/api/shopify/stores/${store.id}/health-check`
    );
    expect(check.json.data.ok).toBe(false);
  });

  it("manages the app registry without exposing the secret", async () => {
    const owner = await createActor("Owner");
    const base = `/api/organizations/${owner.organizationId}/shopify/apps`;
    const appId = await registerApp(owner);

    const duplicate = await call(owner, "POST", base, {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      name: "Duplicate",
    });
    expect(duplicate.status).toBe(409);

    await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/shopify/stores/client-credentials`,
      { appId, shopDomains: [shop()] }
    );
    const listed = await call(owner, "GET", base);
    expect(listed.json.data).toEqual([
      expect.objectContaining({
        hasClientSecret: true,
        id: appId,
        storeCount: 1,
      }),
    ]);
    expect(listed.json.data[0]).not.toHaveProperty("clientSecret");
    expect(listed.json.data[0]).not.toHaveProperty("clientSecretEncrypted");

    const rotated = await call(owner, "PATCH", `${base}/${appId}`, {
      clientSecret: `${CLIENT_SECRET}-rotated`,
      name: "Renamed app",
      tokenMode: "EXPIRING",
    });
    expect(rotated.json.data).toMatchObject({
      name: "Renamed app",
      tokenMode: "EXPIRING",
    });
    await expect(
      prisma.shopifyStore.findFirstOrThrow({ where: { appId } })
    ).resolves.toMatchObject({ lastHealthCheckAt: null });

    const inUse = await call(owner, "DELETE", `${base}/${appId}`);
    expect(inUse.status).toBe(409);

    const stores = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/shopify/stores`
    );
    await prisma.shopifyStore.deleteMany({
      where: {
        id: { in: stores.json.data.map(({ id }: { id: string }) => id) },
      },
    });
    const deleted = await call(owner, "DELETE", `${base}/${appId}`);
    expect(deleted.status).toBe(204);
  });
});

describe("response bodies", () => {
  it("never contained a token or secret in any test above", () => {
    expect(responseBodies.length).toBeGreaterThan(40);
    for (const marker of SECRET_MARKERS) {
      expect(responseBodies.filter((body) => body.includes(marker))).toEqual(
        []
      );
    }
  });
});
