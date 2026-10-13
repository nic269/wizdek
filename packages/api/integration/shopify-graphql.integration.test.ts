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
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Actor, createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const STATIC_TOKEN = "shpat_console_token_value";
const SHOP_QUERY = "query Shop { shop { name } }";
const TAG_MUTATION =
  "mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }";
const READ_AND_WRITE = `${SHOP_QUERY} ${TAG_MUTATION}`;
const ORDER_ID = "gid://shopify/Order/1";
const INTROSPECTION_QUERY =
  "query IntrospectionQuery { __schema { queryType { name } types { name } } }";
const SHA256_HEX = /^[0-9a-f]{64}$/;

const {
  call,
  cleanup,
  createActor,
  createActorWithPermissions,
  createOrganization,
  responseBodies,
} = createApiHarness();
const logLines: string[] = [];
let server: FakeShopifyServer;

const connectStore = async (owner: Actor) => {
  const response = await call(
    owner,
    "POST",
    `/api/organizations/${owner.organizationId}/shopify/stores/static-token`,
    {
      accessToken: STATIC_TOKEN,
      shopDomain: `console-${randomUUID()}.myshopify.com`,
    }
  );
  expect(response.status).toBe(201);
  return response.json.data.id as string;
};

const execute = (
  actor: Actor,
  storeId: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
) =>
  call(actor, "POST", `/api/shopify/stores/${storeId}/graphql`, body, headers);

const consoleAudits = (storeId: string) =>
  prisma.auditLog.findMany({
    orderBy: { createdAt: "asc" },
    where: { action: { startsWith: "shopify.graphql." }, targetId: storeId },
  });

/** A team with a store, plus a member whose custom role can only query. */
const createTeam = async () => {
  const organization = await createOrganization();
  const owner = await createActor("Owner", organization);
  const member = await createActor("Member", organization);
  const queryOnly = await createActorWithPermissions(
    organization.organizationId,
    [{ action: "query", module: "graphql" }]
  );
  const storeId = await connectStore(owner);
  server.graphqlRequests.length = 0;
  return { member, owner, queryOnly, storeId };
};

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken(STATIC_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      logLines.push(parts.map((part) => JSON.stringify(part)).join(" "));
    });
  }
});

beforeEach(() => {
  server.seedOrder({
    id: ORDER_ID,
    name: "#1001",
    tags: [],
    totalPrice: "10.00",
  });
});

afterEach(cleanup);

afterAll(async () => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  await server.close();
  await prisma.$disconnect();
});

describe("console permissions", () => {
  it("lets a query-only role run a query and refuses its mutation before forwarding", async () => {
    const { queryOnly, storeId } = await createTeam();

    const query = await execute(queryOnly, storeId, { query: SHOP_QUERY });
    expect(query.status).toBe(200);
    expect(query.json.data).toMatchObject({
      body: { data: { shop: { name: "Fake Store" } } },
      httpStatus: 200,
    });
    expect(query.json.data.shopifyRequestId).toBeTruthy();
    expect(server.graphqlRequests).toHaveLength(1);

    const mutation = await execute(queryOnly, storeId, {
      query: TAG_MUTATION,
      variables: { id: ORDER_ID, tags: ["vip"] },
    });
    expect(mutation.status).toBe(403);
    expect(server.graphqlRequests).toHaveLength(1);
    expect(server.order(ORDER_ID)?.tags).toEqual([]);
    await expect(consoleAudits(storeId)).resolves.toHaveLength(1);
  });

  it("lets a member run both a query and a mutation", async () => {
    const { member, storeId } = await createTeam();

    expect((await execute(member, storeId, { query: SHOP_QUERY })).status).toBe(
      200
    );
    const mutation = await execute(member, storeId, {
      query: TAG_MUTATION,
      variables: { id: ORDER_ID, tags: ["vip"] },
    });

    expect(mutation.status).toBe(200);
    expect(mutation.json.data.body.data.tagsAdd.userErrors).toEqual([]);
    expect(server.order(ORDER_ID)?.tags).toEqual(["vip"]);
  });

  it("decides by the selected operation, not by what the client claims", async () => {
    const { queryOnly, storeId } = await createTeam();

    const read = await execute(queryOnly, storeId, {
      operationName: "Shop",
      query: READ_AND_WRITE,
    });
    expect(read.status).toBe(200);

    const write = await execute(queryOnly, storeId, {
      operationName: "Tag",
      query: READ_AND_WRITE,
      variables: { id: ORDER_ID, tags: ["vip"] },
    });
    expect(write.status).toBe(403);

    const ambiguous = await execute(queryOnly, storeId, {
      query: READ_AND_WRITE,
    });
    expect(ambiguous.status).toBe(422);
    expect(ambiguous.json.error.details.reason).toBe("AMBIGUOUS_OPERATION");
    expect(server.graphqlRequests).toHaveLength(1);
  });

  it("rejects subscriptions and answers a parse error without forwarding", async () => {
    const { member, storeId } = await createTeam();

    const subscription = await execute(member, storeId, {
      query: "subscription { orderCreated { id } }",
    });
    expect(subscription.status).toBe(422);

    const broken = await execute(member, storeId, { query: "query {" });
    expect(broken.status).toBe(200);
    expect(broken.json.data.httpStatus).toBe(400);
    expect(broken.json.data.body.errors[0].message).toContain("Syntax Error");

    expect(server.graphqlRequests).toHaveLength(0);
    await expect(consoleAudits(storeId)).resolves.toHaveLength(0);
  });

  it("answers 404 for a store in another organization and 403 without the permission", async () => {
    const { storeId } = await createTeam();
    const outsider = await createActor("Owner");
    const viewer = await createActor("Viewer", await createOrganization());

    const foreign = await execute(outsider, storeId, { query: SHOP_QUERY });
    expect(foreign.status).toBe(404);
    const foreignVersions = await call(
      outsider,
      "GET",
      `/api/shopify/stores/${storeId}/api-versions`
    );
    expect(foreignVersions.status).toBe(404);

    const viewerStore = await prisma.shopifyStore.create({
      data: {
        apiVersion: "2026-07",
        name: "Viewer store",
        organizationId: viewer.organizationId,
        shopDomain: `viewer-${randomUUID()}.myshopify.com`,
        strategy: "STATIC_TOKEN",
      },
    });
    const forbidden = await execute(viewer, viewerStore.id, {
      query: SHOP_QUERY,
    });
    expect(forbidden.status).toBe(403);
    expect(server.graphqlRequests).toHaveLength(0);
  });

  it("refuses a write sent from another origin", async () => {
    const { member, storeId } = await createTeam();

    const foreign = await execute(
      member,
      storeId,
      { query: SHOP_QUERY },
      { origin: "https://evil.example" }
    );
    expect(foreign.status).toBe(403);
    expect(server.graphqlRequests).toHaveLength(0);

    const own = await execute(
      member,
      storeId,
      { query: SHOP_QUERY },
      { origin: new URL(process.env.NEXT_PUBLIC_APP_URL as string).origin }
    );
    expect(own.status).toBe(200);
  });
});

describe("console execution", () => {
  it("audits each execution with the document and variables, but not introspection", async () => {
    const { member, storeId } = await createTeam();
    const variables = { id: "gid://shopify/Order/404", tags: ["vip"] };

    await execute(member, storeId, { query: INTROSPECTION_QUERY });
    await expect(consoleAudits(storeId)).resolves.toHaveLength(0);

    await execute(member, storeId, { query: SHOP_QUERY });
    await execute(member, storeId, { query: TAG_MUTATION, variables });

    const [queryAudit, mutationAudit] = await consoleAudits(storeId);
    expect(queryAudit).toMatchObject({
      action: "shopify.graphql.query",
      actorId: member.userId,
      organizationId: member.organizationId,
      targetType: "ShopifyStore",
    });
    expect(queryAudit?.metadata).toMatchObject({
      actualQueryCost: 2,
      apiVersion: "2026-07",
      document: SHOP_QUERY,
      graphqlErrorCount: 0,
      httpStatus: 200,
      operationName: "Shop",
      operationType: "query",
      requestedQueryCost: 3,
      userErrorCount: 0,
      variables: null,
    });
    const metadata = mutationAudit?.metadata as Record<string, unknown>;
    expect(mutationAudit?.action).toBe("shopify.graphql.mutation");
    expect(metadata).toMatchObject({
      document: TAG_MUTATION,
      operationName: "Tag",
      operationType: "mutation",
      userErrorCount: 1,
      variables,
    });
    expect(metadata.documentSha256).toMatch(SHA256_HEX);
    expect(typeof metadata.durationMs).toBe("number");
    expect(metadata.shopifyRequestId).toBeTruthy();
  });

  it("passes cost debugging and the chosen API version upstream", async () => {
    const { member, storeId } = await createTeam();

    const plain = await execute(member, storeId, { query: SHOP_QUERY });
    expect(server.graphqlRequests.at(-1)).toMatchObject({
      apiVersion: "2026-07",
      costDebug: false,
    });
    expect(plain.json.data.cost).toMatchObject({
      actualQueryCost: 2,
      requestedQueryCost: 3,
      throttleStatus: { maximumAvailable: 2000 },
    });
    expect(plain.json.data.cost.fields).toBeUndefined();

    const detailed = await execute(member, storeId, {
      apiVersion: "2026-04",
      costDebug: true,
      query: SHOP_QUERY,
    });
    expect(server.graphqlRequests.at(-1)).toMatchObject({
      apiVersion: "2026-04",
      costDebug: true,
    });
    expect(detailed.json.data.cost.fields).toHaveLength(1);

    const badVersion = await execute(member, storeId, {
      apiVersion: "../../oauth",
      query: SHOP_QUERY,
    });
    expect(badVersion.status).toBe(422);
  });

  it("returns Shopify's errors untouched and flags the store on a 401", async () => {
    const { member, storeId } = await createTeam();

    server.throttleNext();
    const throttled = await execute(member, storeId, { query: SHOP_QUERY });
    expect(throttled.status).toBe(200);
    expect(throttled.json.data.body.errors).toEqual([
      { extensions: { code: "THROTTLED" }, message: "Throttled" },
    ]);

    server.failNextWithUnauthorized();
    const unauthorized = await execute(member, storeId, { query: SHOP_QUERY });
    expect(unauthorized.status).toBe(200);
    expect(unauthorized.json.data.httpStatus).toBe(401);
    await expect(
      prisma.shopifyStore.findUniqueOrThrow({ where: { id: storeId } })
    ).resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
  });

  it("lists the API versions the store offers", async () => {
    const { queryOnly, storeId } = await createTeam();

    const response = await call(
      queryOnly,
      "GET",
      `/api/shopify/stores/${storeId}/api-versions`
    );

    expect(response.status).toBe(200);
    expect(response.json.data.current).toBe("2026-07");
    expect(response.json.data.versions).toContainEqual({
      displayName: "2026-07 (Latest)",
      handle: "2026-07",
      supported: true,
    });
  });

  it("limits the document size", async () => {
    const { member, storeId } = await createTeam();
    const oversized = await execute(member, storeId, {
      query: `query { shop { name } } #${"x".repeat(500_000)}`,
    });
    expect(oversized.status).toBe(422);
    expect(server.graphqlRequests).toHaveLength(0);
  });
});

describe("audit log filter", () => {
  it("returns only actions with the requested prefix", async () => {
    const { member, owner, storeId } = await createTeam();
    await execute(member, storeId, { query: SHOP_QUERY });
    const base = `/api/organizations/${owner.organizationId}/audit-logs`;

    const all = await call(owner, "GET", base);
    const consoleOnly = await call(
      owner,
      "GET",
      `${base}?actionPrefix=shopify.graphql.`
    );
    const stores = await call(
      owner,
      "GET",
      `${base}?actionPrefix=shopify.store.`
    );

    const actions = (response: typeof all) =>
      response.json.data.map(({ action }: { action: string }) => action);
    expect(actions(all)).toEqual(
      expect.arrayContaining([
        "shopify.graphql.query",
        "shopify.store.connected",
      ])
    );
    expect(actions(consoleOnly)).toEqual(["shopify.graphql.query"]);
    expect(actions(stores)).toEqual(["shopify.store.connected"]);
    expect((await call(owner, "GET", `${base}?actionPrefix=%25`)).status).toBe(
      422
    );
  });
});

describe("saved queries", () => {
  it("shares saved queries within the organization and limits who can change them", async () => {
    const { member, owner, queryOnly } = await createTeam();
    const outsider = await createActor("Owner");
    const base = `/api/organizations/${owner.organizationId}/graphql/saved-queries`;

    const created = await call(member, "POST", base, {
      name: "Shop name",
      query: SHOP_QUERY,
      variables: "{}",
    });
    expect(created.status).toBe(201);
    const { id } = created.json.data;

    const duplicate = await call(owner, "POST", base, {
      name: "Shop name",
      query: SHOP_QUERY,
    });
    expect(duplicate.status).toBe(409);

    const listed = await call(queryOnly, "GET", base);
    expect(listed.json.data).toEqual([
      expect.objectContaining({
        id,
        name: "Shop name",
        query: SHOP_QUERY,
        variables: "{}",
      }),
    ]);

    const notCreator = await call(queryOnly, "PATCH", `${base}/${id}`, {
      name: "Mine",
    });
    expect(notCreator.status).toBe(403);
    expect((await call(queryOnly, "DELETE", `${base}/${id}`)).status).toBe(403);

    const renamed = await call(member, "PATCH", `${base}/${id}`, {
      name: "Shop details",
      variables: null,
    });
    expect(renamed.json.data).toMatchObject({
      name: "Shop details",
      variables: null,
    });

    expect((await call(outsider, "GET", base)).status).toBe(403);
    expect((await call(outsider, "DELETE", `${base}/${id}`)).status).toBe(403);

    expect((await call(owner, "DELETE", `${base}/${id}`)).status).toBe(204);
    expect((await call(owner, "GET", base)).json.data).toEqual([]);
    expect((await call(owner, "DELETE", `${base}/${id}`)).status).toBe(404);
  });
});

describe("secrets", () => {
  it("never put the store token in a response body or a log line", () => {
    expect(responseBodies.length).toBeGreaterThan(30);
    expect(logLines.length).toBeGreaterThan(30);
    expect(
      responseBodies.filter((body) => body.includes(STATIC_TOKEN))
    ).toEqual([]);
    expect(logLines.filter((line) => line.includes(STATIC_TOKEN))).toEqual([]);
  });
});
