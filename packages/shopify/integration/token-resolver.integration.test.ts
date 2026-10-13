import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createStore,
  createStoreClient,
  findActiveToken,
  resolveAccessToken,
  runStoreHealthCheck,
  StoreNotFoundError,
  StoreReconnectRequiredError,
  saveToken,
} from "../src/stores";
import { type FakeShopifyServer, startFakeShopifyServer } from "../src/testing";

// The suite creates and removes its own rows, so a throwaway key is enough
// when the environment does not provide one.
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const organizationIds: string[] = [];
let server: FakeShopifyServer;

const createOrganization = async () => {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Shopify ${suffix}`, slug: `shopify-${suffix}` },
  });
  organizationIds.push(organization.id);
  return organization;
};

const createConnectedStore = async (
  strategy: "STATIC_TOKEN" | "OAUTH" | "CLIENT_CREDENTIALS"
) => {
  const organization = await createOrganization();
  const app =
    strategy === "STATIC_TOKEN"
      ? undefined
      : await createApp({
          clientId: "fake-client-id",
          clientSecret: "fake-client-secret",
          name: "Fake app",
          organizationId: organization.id,
          scopes: ["read_orders"],
          tokenMode: strategy === "OAUTH" ? "EXPIRING" : "NON_EXPIRING",
        });
  const store = await createStore({
    appId: app?.id,
    organizationId: organization.id,
    shopDomain: `store-${randomUUID()}.myshopify.com`,
    strategy,
  });
  return { organizationId: organization.id, storeId: store.id };
};

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000);

beforeAll(async () => {
  server = await startFakeShopifyServer();
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
});

afterEach(async () => {
  server.tokenRequests.length = 0;
  server.setTokenDelay(0);
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds.splice(0) } },
  });
});

afterAll(async () => {
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  await server.close();
  await prisma.$disconnect();
});

describe("access token resolution", () => {
  it("returns a pasted static token and stores it encrypted", async () => {
    const scope = await createConnectedStore("STATIC_TOKEN");
    await saveToken(
      scope.storeId,
      {
        accessToken: "shpat_static",
        accessTokenExpiresAt: undefined,
        refreshToken: undefined,
        refreshTokenExpiresAt: undefined,
        scopes: [],
      },
      "revoke"
    );

    await expect(resolveAccessToken(scope)).resolves.toBe("shpat_static");
    const stored = await findActiveToken(scope.storeId);
    expect(stored?.accessTokenEncrypted.startsWith("v1.")).toBe(true);
    expect(stored?.accessTokenEncrypted).not.toContain("shpat_static");
    expect(server.tokenRequests).toHaveLength(0);
  });

  it("requests one client-credentials token for concurrent callers", async () => {
    const scope = await createConnectedStore("CLIENT_CREDENTIALS");
    await saveToken(
      scope.storeId,
      {
        accessToken: "shpat_expired",
        accessTokenExpiresAt: minutesFromNow(-1),
        refreshToken: undefined,
        refreshTokenExpiresAt: undefined,
        scopes: [],
      },
      "rotate"
    );
    server.setTokenDelay(150);

    const [first, second] = await Promise.all([
      resolveAccessToken(scope),
      resolveAccessToken(scope),
    ]);

    expect(first).toBe(second);
    expect(first).not.toBe("shpat_expired");
    expect(server.tokenRequests.map(({ grant }) => grant)).toEqual([
      "client-credentials",
    ]);

    // A token with plenty of life left is reused without another request.
    await expect(resolveAccessToken(scope)).resolves.toBe(first);
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("refreshes an expiring OAuth token once and marks the old row rotated", async () => {
    const scope = await createConnectedStore("OAUTH");
    const issued = await fetch(`${server.url}/admin/oauth/access_token`, {
      body: JSON.stringify({
        client_id: "fake-client-id",
        client_secret: "fake-client-secret",
        code: "install-code",
        expiring: "1",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).then(
      (response) =>
        response.json() as Promise<{
          access_token: string;
          refresh_token: string;
        }>
    );
    server.tokenRequests.length = 0;
    const original = await saveToken(
      scope.storeId,
      {
        accessToken: issued.access_token,
        // Inside the renewal margin, so it must be refreshed before use.
        accessTokenExpiresAt: minutesFromNow(2),
        refreshToken: issued.refresh_token,
        refreshTokenExpiresAt: minutesFromNow(60 * 24 * 90),
        scopes: ["read_orders"],
      },
      "revoke"
    );
    server.setTokenDelay(150);

    const [first, second] = await Promise.all([
      resolveAccessToken(scope),
      resolveAccessToken(scope),
    ]);

    expect(first).toBe(second);
    expect(first).not.toBe(issued.access_token);
    expect(server.tokenRequests.map(({ grant }) => grant)).toEqual([
      "refresh-token",
    ]);
    expect(server.tokenRequests[0]?.params.refresh_token).toBe(
      issued.refresh_token
    );

    const previous = await prisma.shopifyToken.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(previous.rotatedAt).toBeInstanceOf(Date);
    const active = await findActiveToken(scope.storeId);
    expect(active?.id).not.toBe(original.id);
    expect(active?.refreshTokenEncrypted).not.toBeNull();
    expect(active?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(
      minutesFromNow(30).getTime()
    );
  });

  it("asks for a reconnect when Shopify refuses the refresh", async () => {
    const scope = await createConnectedStore("OAUTH");
    await saveToken(
      scope.storeId,
      {
        accessToken: "shpat_old",
        accessTokenExpiresAt: minutesFromNow(-1),
        refreshToken: "shprt_revoked",
        refreshTokenExpiresAt: minutesFromNow(60),
        scopes: [],
      },
      "revoke"
    );

    await expect(resolveAccessToken(scope)).rejects.toBeInstanceOf(
      StoreReconnectRequiredError
    );
    const store = await prisma.shopifyStore.findUniqueOrThrow({
      where: { id: scope.storeId },
    });
    expect(store.status).toBe("RECONNECT_REQUIRED");
    // The failed renewal must not have discarded the stored credentials.
    expect((await findActiveToken(scope.storeId))?.rotatedAt).toBeNull();
  });
});

describe("store client", () => {
  it("runs the health check and records the shop details", async () => {
    const scope = await createConnectedStore("CLIENT_CREDENTIALS");

    await expect(runStoreHealthCheck(scope)).resolves.toEqual({
      currencyCode: "USD",
      ok: true,
      scopes: ["read_orders", "write_orders"],
      shopName: "Fake Store",
    });
    const store = await prisma.shopifyStore.findUniqueOrThrow({
      where: { id: scope.storeId },
    });
    expect(store).toMatchObject({
      currencyCode: "USD",
      lastHealthCheckError: null,
      name: "Fake Store",
      scopes: ["read_orders", "write_orders"],
      status: "CONNECTED",
    });
    expect(store.connectedAt).toBeInstanceOf(Date);
  });

  it("flips the store to reconnect-required on a 401", async () => {
    const scope = await createConnectedStore("CLIENT_CREDENTIALS");
    await runStoreHealthCheck(scope);
    const client = await createStoreClient(scope);
    server.failNextWithUnauthorized();

    const result = await client.request({ query: "{ shop { name } }" });

    expect(result.httpStatus).toBe(401);
    const store = await prisma.shopifyStore.findUniqueOrThrow({
      where: { id: scope.storeId },
    });
    expect(store.status).toBe("RECONNECT_REQUIRED");
    expect(store.lastHealthCheckError).toContain("401");

    // A later successful check brings the store back.
    await expect(runStoreHealthCheck(scope)).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      prisma.shopifyStore.findUniqueOrThrow({ where: { id: scope.storeId } })
    ).resolves.toMatchObject({
      lastHealthCheckError: null,
      status: "CONNECTED",
    });
  });

  it("treats a store id from another organization as not found", async () => {
    const scope = await createConnectedStore("CLIENT_CREDENTIALS");
    const other = await createOrganization();
    const foreign = { organizationId: other.id, storeId: scope.storeId };

    await expect(resolveAccessToken(foreign)).rejects.toBeInstanceOf(
      StoreNotFoundError
    );
    await expect(createStoreClient(foreign)).rejects.toBeInstanceOf(
      StoreNotFoundError
    );
    await expect(runStoreHealthCheck(foreign)).rejects.toBeInstanceOf(
      StoreNotFoundError
    );
    expect(server.tokenRequests).toHaveLength(0);
  });
});
