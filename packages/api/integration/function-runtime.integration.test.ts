import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import {
  type FakeRunner,
  fakeExit,
  startFakeRunner,
} from "@repo/functions/testing";
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
import { createFunctionRuntimeApp } from "../src/app";
import { type Actor, createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";

const STATIC_TOKEN = "shpat_runtime_token_value";
const ORDER_ID = "gid://shopify/Order/1";
const SHOP_QUERY = "query Shop { shop { name } }";
const TAG_MUTATION =
  "mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }";
const STARTER_PARAMS = { name: "runtime" };
const table = `fn_runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const {
  call,
  cleanup,
  createActor,
  createActorWithPermissions,
  createOrganization,
  responseBodies,
} = createApiHarness();
const runtimeApp = createFunctionRuntimeApp();
/** Every runtime API answer, for scanning that no credential was returned. */
const runtimeBodies: string[] = [];

let fake: FakeRunner;
let shopify: FakeShopifyServer;
let owner: Actor;

/** Calls the runtime API as a run's code does. */
const runtime = async (
  token: string | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown
) => {
  const response = await runtimeApp.request(`/api/fn-runtime${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    method,
  });
  const text = await response.text();
  runtimeBodies.push(text);
  return { json: text ? JSON.parse(text) : null, status: response.status, text };
};

const createFunction = async (actor: Actor, name: string) => {
  const created = await call(
    actor,
    "POST",
    `/api/organizations/${actor.organizationId}/functions`,
    { name, runtime: "NODE" }
  );
  expect(created.status).toBe(201);
  return created.json.data as { id: string; sourceHash: string };
};

const connectDatabase = async (actor: Actor, name: string) => {
  const created = await call(
    actor,
    "POST",
    `/api/organizations/${actor.organizationId}/databases/connections`,
    { name, url: process.env.DATABASE_URL }
  );
  expect(created.status).toBe(201);
  return created.json.data.id as string;
};

const connectStore = async (actor: Actor) => {
  const created = await call(
    actor,
    "POST",
    `/api/organizations/${actor.organizationId}/shopify/stores/static-token`,
    {
      accessToken: STATIC_TOKEN,
      shopDomain: `runtime-${randomUUID()}.myshopify.com`,
    }
  );
  expect(created.status).toBe(201);
  return created.json.data.id as string;
};

const grant = (
  actor: Actor,
  functionId: string,
  body: { alias?: string; kind: "DATABASE" | "STORE"; resourceId: string }
) => call(actor, "POST", `/api/functions/${functionId}/grants`, body);

/** A running run of the function, holding a helper token. */
const activeRun = async (
  fn: { id: string; sourceHash: string },
  actor: Actor
) => {
  const token = `wfr_${randomBytes(32).toString("base64url")}`;
  const run = await prisma.codeFunctionRun.create({
    data: {
      functionId: fn.id,
      number: Math.floor(Math.random() * 1_000_000_000),
      organizationId: actor.organizationId,
      params: {},
      runtimeTokenHash: createHash("sha256").update(token).digest("hex"),
      sourceHash: fn.sourceHash,
      startedAt: new Date(),
      startedById: actor.userId,
      status: "RUNNING",
      trigger: "MANUAL",
    },
  });
  return { runId: run.id, token };
};

const waitForRun = async (runId: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const run = await prisma.codeFunctionRun.findUniqueOrThrow({
      where: { id: runId },
    });
    if (!["QUEUED", "RUNNING"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The run did not finish in time.");
};

const auditsOf = (action: string, runId: string) =>
  prisma.auditLog.findMany({
    orderBy: { createdAt: "asc" },
    where: { action, metadata: { path: ["runId"], equals: runId } },
  });

/** A function of the owner's organization granted a database and a store. */
const grantedFunction = async (name: string) => {
  const fn = await createFunction(owner, name);
  const connectionId = await connectDatabase(owner, `Analytics ${name}`);
  const storeId = await connectStore(owner);
  const database = await grant(owner, fn.id, {
    alias: "analytics",
    kind: "DATABASE",
    resourceId: connectionId,
  });
  expect(database.status).toBe(201);
  const store = await grant(owner, fn.id, {
    alias: "main-store",
    kind: "STORE",
    resourceId: storeId,
  });
  expect(store.status).toBe(201);
  return { connectionId, fn, storeId };
};

beforeAll(async () => {
  fake = await startFakeRunner();
  shopify = await startFakeShopifyServer();
  shopify.acceptToken(STATIC_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = shopify.url;
  process.env.FUNCTIONS_RUNNER_URL = fake.url;
  process.env.FUNCTIONS_RUNNER_TOKEN = fake.token;
  process.env.FUNCTIONS_RUNTIME_URL = "http://runtime.test:3003";
  await prisma.$executeRawUnsafe(
    `create table ${table} (id serial primary key, note text not null)`
  );
  const organization = await createOrganization();
  owner = await createActor("Owner", organization);
});

afterEach(() => {
  fake.reset();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`drop table if exists ${table}`);
  await cleanup();
  await fake?.close();
  await shopify?.close();
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  Reflect.deleteProperty(process.env, "FUNCTIONS_RUNTIME_URL");
});

describe("the run token", () => {
  it("reaches the helpers while the run lasts, is scrubbed from output and dies with the run", async () => {
    const { fn } = await grantedFunction("Token life");
    let seenToken = "";
    fake.state.script = async function* ({ request }) {
      seenToken = request.env.WIZDEK_RUNTIME_TOKEN ?? "";
      yield { type: "started" };
      const context = await runtime(seenToken, "GET", "/context");
      yield {
        data: `token=${seenToken} status=${context.status}\n`,
        stream: "stdout",
        type: "output",
      };
      yield fakeExit({ result: context.json });
    };

    const started = await call(owner, "POST", `/api/functions/${fn.id}/runs`, {
      params: STARTER_PARAMS,
    });
    expect(started.status).toBe(201);
    const run = await waitForRun(started.json.data.id);

    const request = fake.state.requests.at(-1);
    expect(request?.env).toMatchObject({
      WIZDEK_FUNCTION_ID: fn.id,
      WIZDEK_ORGANIZATION_ID: owner.organizationId,
      WIZDEK_RUN_ID: run.id,
      WIZDEK_RUNTIME_URL: "http://runtime.test:3003",
      WIZDEK_TRIGGER: "MANUAL",
    });
    expect(seenToken.startsWith("wfr_")).toBe(true);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.result).toMatchObject({
      functionId: fn.id,
      grants: { databases: ["analytics"], stores: ["main-store"] },
      runId: run.id,
      trigger: "MANUAL",
    });
    expect(run.output).toContain("token=[redacted] status=200");
    expect(run.output).not.toContain(seenToken);
    expect(run.runtimeTokenHash).toBeNull();

    const replay = await runtime(seenToken, "GET", "/context");
    expect(replay.status).toBe(401);
    expect(replay.text).toBe("");
  });

  it("answers 401 with an empty body for a missing, unknown or finished token", async () => {
    const fn = await createFunction(owner, "Refusals");
    const { runId, token } = await activeRun(fn, owner);
    for (const candidate of [null, "wfr_unknown", "not-a-token"]) {
      const refused = await runtime(candidate, "GET", "/context");
      expect(refused.status).toBe(401);
      expect(refused.text).toBe("");
    }
    expect((await runtime(token, "GET", "/context")).status).toBe(200);
    await prisma.codeFunctionRun.update({
      data: { status: "CANCELED" },
      where: { id: runId },
    });
    expect((await runtime(token, "GET", "/context")).status).toBe(401);
  });
});

describe("granting", () => {
  it("needs the resource's own permissions and an organization's own resource", async () => {
    const fn = await createFunction(owner, "Grant rules");
    const connectionId = await connectDatabase(owner, "Grant rules DB");
    const storeId = await connectStore(owner);
    const manager = await createActorWithPermissions(owner.organizationId, [
      { action: "read", module: "functions" },
      { action: "manage", module: "functions" },
      { action: "read", module: "stores" },
      { action: "query", module: "graphql" },
    ]);

    const store = await grant(manager, fn.id, {
      kind: "STORE",
      resourceId: storeId,
    });
    expect(store.status).toBe(403);
    const database = await grant(manager, fn.id, {
      kind: "DATABASE",
      resourceId: connectionId,
    });
    expect(database.status).toBe(403);

    const other = await createActor("Owner");
    const otherFn = await createFunction(other, "Other org");
    const foreign = await grant(other, otherFn.id, {
      kind: "DATABASE",
      resourceId: connectionId,
    });
    expect(foreign.status).toBe(422);

    const added = await grant(owner, fn.id, {
      kind: "DATABASE",
      resourceId: connectionId,
    });
    expect(added.status).toBe(201);
    expect(added.json.data).toMatchObject({
      alias: "grant-rules-db",
      kind: "DATABASE",
      resourceName: "Grant rules DB",
    });
    const again = await grant(owner, fn.id, {
      alias: "second",
      kind: "DATABASE",
      resourceId: connectionId,
    });
    expect(again.status).toBe(422);

    const listed = await call(owner, "GET", `/api/functions/${fn.id}/grants`);
    expect(listed.json.data).toHaveLength(1);
    const audits = await prisma.auditLog.findMany({
      where: { action: "function.grant.added", targetId: fn.id },
    });
    expect(audits).toHaveLength(1);
  });

  it("removing a grant, deleting the connection or disconnecting the store blocks the next call", async () => {
    const { connectionId, fn, storeId } = await grantedFunction("Revoke");
    const { token } = await activeRun(fn, owner);
    const select = { params: [], sql: "select 1 as one" };
    expect(
      (await runtime(token, "POST", "/db/analytics/query", select)).status
    ).toBe(200);

    const grants = await call(owner, "GET", `/api/functions/${fn.id}/grants`);
    const databaseGrant = grants.json.data.find(
      (entry: { kind: string }) => entry.kind === "DATABASE"
    );
    const removed = await call(
      owner,
      "DELETE",
      `/api/function-grants/${databaseGrant.id}`
    );
    expect(removed.status).toBe(200);
    const blocked = await runtime(token, "POST", "/db/analytics/query", select);
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toContain('"analytics"');

    await grant(owner, fn.id, {
      alias: "analytics",
      kind: "DATABASE",
      resourceId: connectionId,
    });
    const deleted = await call(
      owner,
      "DELETE",
      `/api/databases/connections/${connectionId}`
    );
    expect(deleted.status).toBe(200);
    const disconnected = await call(
      owner,
      "DELETE",
      `/api/shopify/stores/${storeId}`
    );
    expect(disconnected.status).toBe(200);
    await expect(
      prisma.codeFunctionGrant.count({ where: { functionId: fn.id } })
    ).resolves.toBe(0);
    expect(
      (
        await runtime(token, "POST", "/shopify/main-store/graphql", {
          query: SHOP_QUERY,
        })
      ).status
    ).toBe(403);
  });
});

describe("database helpers", () => {
  it("reads without an audit entry, audits writes with their SQL but not their values, and counts every call", async () => {
    const { fn } = await grantedFunction("Database calls");
    const { runId, token } = await activeRun(fn, owner);

    const inserted = await runtime(token, "POST", "/db/analytics/query", {
      params: ["secret-note-value"],
      sql: `insert into ${table} (note) values ($1)`,
    });
    expect(inserted.status).toBe(200);
    expect(inserted.json).toMatchObject({ command: "INSERT", rowCount: 1 });

    const read = await runtime(token, "POST", "/db/analytics/query", {
      params: ["secret-note-value"],
      sql: `-- the note\nselect note from ${table} where note = $1`,
    });
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({
      command: "SELECT",
      rows: [{ note: "secret-note-value" }],
      truncated: false,
    });
    expect(read.json.fields[0].name).toBe("note");

    const writes = await auditsOf("function.db.write", runId);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.actorId).toBe(owner.userId);
    expect(writes[0]?.metadata).toMatchObject({
      alias: "analytics",
      functionId: fn.id,
      statements: [
        {
          command: "INSERT",
          rowCount: 1,
          sql: `insert into ${table} (note) values ($1)`,
        },
      ],
      succeeded: true,
    });
    expect(JSON.stringify(writes[0]?.metadata)).not.toContain(
      "secret-note-value"
    );
    const run = await prisma.codeFunctionRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.dbCallCount).toBe(2);
  });

  it("runs a transaction all or nothing and refuses several statements in one text", async () => {
    const { fn } = await grantedFunction("Transactions");
    const { token } = await activeRun(fn, owner);

    const failed = await runtime(token, "POST", "/db/analytics/transaction", {
      statements: [
        { params: ["rolled-back"], sql: `insert into ${table} (note) values ($1)` },
        { params: [], sql: "select * from no_such_table_here" },
      ],
    });
    expect(failed.status).toBe(422);
    expect(failed.json.error).toContain("no_such_table_here");
    await expect(
      prisma.$queryRawUnsafe(
        `select count(*)::int as n from ${table} where note = 'rolled-back'`
      )
    ).resolves.toEqual([{ n: 0 }]);

    const committed = await runtime(
      token,
      "POST",
      "/db/analytics/transaction",
      {
        statements: [
          { params: ["kept"], sql: `insert into ${table} (note) values ($1)` },
          { params: ["kept"], sql: `select note from ${table} where note = $1` },
        ],
      }
    );
    expect(committed.status).toBe(200);
    expect(committed.json.results[1].rows).toEqual([{ note: "kept" }]);

    const stacked = await runtime(token, "POST", "/db/analytics/query", {
      params: [],
      sql: `select 1; delete from ${table}`,
    });
    expect(stacked.status).toBe(422);
    await expect(
      prisma.$queryRawUnsafe(`select count(*)::int as n from ${table}`)
    ).resolves.not.toEqual([{ n: 0 }]);
  });

  it("cuts large results, refuses an ungranted alias and limits calls in flight", async () => {
    const { fn } = await grantedFunction("Limits");
    const { token } = await activeRun(fn, owner);

    const large = await runtime(token, "POST", "/db/analytics/query", {
      params: [],
      sql: "select n from generate_series(1, 10001) as n",
    });
    expect(large.status).toBe(200);
    expect(large.json.truncated).toBe(true);
    expect(large.json.rows).toHaveLength(10_000);

    const ungranted = await runtime(token, "POST", "/db/warehouse/query", {
      sql: "select 1",
    });
    expect(ungranted.status).toBe(403);
    expect(ungranted.json.error).toContain('"warehouse"');

    const sleeps = await Promise.all(
      Array.from({ length: 6 }, () =>
        runtime(token, "POST", "/db/analytics/query", {
          sql: "select pg_sleep(0.4)",
        })
      )
    );
    const statuses = sleeps.map(({ status }) => status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(4);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  });

  it("never returns the connection's URL", () => {
    const url = process.env.DATABASE_URL ?? "";
    expect(runtimeBodies.length).toBeGreaterThan(0);
    for (const body of [...runtimeBodies, ...responseBodies]) {
      expect(body).not.toContain(url);
    }
  });
});

describe("Shopify helpers", () => {
  it("runs a query unaudited and a mutation audited with the run", async () => {
    const { fn, storeId } = await grantedFunction("Shopify calls");
    shopify.seedOrder({ id: ORDER_ID, name: "#1001", tags: [], totalPrice: "1.00" });
    const { runId, token } = await activeRun(fn, owner);

    const query = await runtime(token, "POST", "/shopify/main-store/graphql", {
      query: SHOP_QUERY,
    });
    expect(query.status).toBe(200);
    expect(query.json.body).toMatchObject({
      data: { shop: { name: "Fake Store" } },
    });

    const mutation = await runtime(
      token,
      "POST",
      "/shopify/main-store/graphql",
      { query: TAG_MUTATION, variables: { id: ORDER_ID, tags: ["vip"] } }
    );
    expect(mutation.status).toBe(200);
    expect(shopify.order(ORDER_ID)?.tags).toEqual(["vip"]);

    const audits = await prisma.auditLog.findMany({
      where: { action: { startsWith: "shopify.graphql." }, targetId: storeId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "shopify.graphql.mutation",
      actorId: owner.userId,
    });
    expect(audits[0]?.metadata).toMatchObject({ functionId: fn.id, runId });

    const run = await prisma.codeFunctionRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.shopifyCallCount).toBe(2);
    for (const body of [...runtimeBodies, ...responseBodies]) {
      expect(body).not.toContain(STATIC_TOKEN);
    }
  });
});
