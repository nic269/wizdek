import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSession } from "@repo/auth/session";
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
import { type Actor, createApiHarness } from "./support";

vi.mock("@repo/auth/session", () => ({ getCurrentSession: vi.fn() }));

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??=
  "integration-test-encryption-key-32-chars";
// Jobs run in this process and uploads go to a throwaway directory.
process.env.JOBS_PROVIDER = "local";
const storageDirectory = mkdtempSync(join(tmpdir(), "flows-api-test-"));
process.env.STORAGE_PROVIDER = "local";
process.env.LOCAL_STORAGE_DIR = storageDirectory;

const STORE_TOKEN = "shpat_flows_api_token";

const {
  call,
  cleanup,
  createActor,
  createActorWithPermissions,
  createOrganization,
  responseBodies,
} = createApiHarness();
const app = createApiApp();
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

const csvFlow = () => ({
  edges: [
    edge("trigger", "parse"),
    edge("parse", "find"),
    edge("find", "check"),
    edge("check", "tag", "true"),
  ],
  nodes: [
    node("trigger", "trigger.manual", {
      inputs: [{ key: "csvFile", label: "CSV file", type: "file" }],
    }),
    node("parse", "data.parseCsv", { file: "{{ $json.csvFile }}" }),
    node("find", "shopify.findOrder", { value: "{{ $json.Order }}" }),
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
    node("tag", "shopify.addTags", {
      resourceId: "{{ $json.order.id }}",
      tags: ["high-value"],
    }),
  ],
  schemaVersion: 1,
});

const connectStore = async (owner: Actor) => {
  const response = await call(
    owner,
    "POST",
    `/api/organizations/${owner.organizationId}/shopify/stores/static-token`,
    {
      accessToken: STORE_TOKEN,
      shopDomain: `flows-${randomUUID()}.myshopify.com`,
    }
  );
  expect(response.status).toBe(201);
  return response.json.data.id as string;
};

/** Multipart requests bypass the JSON helper, so they are sent directly. */
const upload = async (
  actor: Actor,
  organizationId: string,
  file: File,
  headers: Record<string, string> = {}
) => {
  vi.mocked(getCurrentSession).mockResolvedValue({
    user: { id: actor.userId },
  } as never);
  const body = new FormData();
  body.set("file", file);
  const response = await app.request(
    `/api/organizations/${organizationId}/files`,
    { body, headers, method: "POST" }
  );
  const text = await response.text();
  responseBodies.push(text);
  return { json: JSON.parse(text), status: response.status };
};

const csvFile = (text: string, name = "orders.csv", type = "text/csv") =>
  new File([text], name, { type });

/** A team with a connected store and a saved, valid CSV flow. */
const createTeam = async () => {
  const organization = await createOrganization();
  const owner = await createActor("Owner", organization);
  const member = await createActor("Member", organization);
  const viewer = await createActor("Viewer", organization);
  const storeId = await connectStore(owner);
  const created = await call(
    owner,
    "POST",
    `/api/organizations/${owner.organizationId}/flows`,
    { description: "Tags big orders", name: "Tag high-value orders" }
  );
  expect(created.status).toBe(201);
  const flowId = created.json.data.flow.id as string;
  const saved = await call(owner, "POST", `/api/flows/${flowId}/versions`, {
    baseVersion: 1,
    definition: csvFlow(),
  });
  expect(saved.status).toBe(201);
  return { flowId, member, organization, owner, storeId, viewer };
};

const seedOrders = (prefix: string) => {
  const rows = [
    { name: `#${prefix}-1`, total: "1,500.00" },
    { name: `#${prefix}-2`, total: "20.00" },
    { name: `#${prefix}-3`, total: "2500" },
  ];
  rows.forEach(({ name }, index) => {
    server.seedOrder({
      id: `gid://shopify/Order/${prefix}-${index + 1}`,
      name,
      tags: [],
      totalPrice: "0",
    });
  });
  return `Order,Total\n${rows.map(({ name, total }) => `${name},"${total}"`).join("\n")}\n`;
};

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken(STORE_TOKEN);
  process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE = server.url;
  const jobs = getJobProvider();
  registerJobs(jobs);
  await jobs.start();
});

afterEach(cleanup);

afterAll(async () => {
  await getJobProvider().stop();
  Reflect.deleteProperty(process.env, "SHOPIFY_ADMIN_BASE_URL_OVERRIDE");
  await server.close();
  rmSync(storageDirectory, { force: true, recursive: true });
  await prisma.$disconnect();
});

describe("authoring flows", () => {
  it("creates a flow, saves versions and refuses a stale save", async () => {
    const { flowId, owner } = await createTeam();

    const loaded = await call(owner, "GET", `/api/flows/${flowId}`);
    expect(loaded.json.data).toMatchObject({
      flow: {
        description: "Tags big orders",
        name: "Tag high-value orders",
        status: "DRAFT",
      },
      validation: { issues: [], valid: true },
      version: { version: 2 },
    });
    expect(loaded.json.data.version.definition.nodes).toHaveLength(5);

    const stale = await call(owner, "POST", `/api/flows/${flowId}/versions`, {
      baseVersion: 1,
      definition: csvFlow(),
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.reason).toBe("VERSION_CONFLICT");

    const draft = csvFlow();
    draft.nodes.push(node("orphan", "shopify.addTags"));
    const withIssues = await call(
      owner,
      "POST",
      `/api/flows/${flowId}/versions`,
      {
        baseVersion: 2,
        definition: draft,
      }
    );
    expect(withIssues.status).toBe(201);
    expect(withIssues.json.data.version.version).toBe(3);
    expect(withIssues.json.data.validation.valid).toBe(false);
    expect(
      withIssues.json.data.validation.issues.map(
        ({ code, nodeId }: { code: string; nodeId: string }) =>
          `${code}:${nodeId}`
      )
    ).toEqual(
      expect.arrayContaining(["INVALID_CONFIG:orphan", "UNREACHABLE:orphan"])
    );

    const malformed = await call(
      owner,
      "POST",
      `/api/flows/${flowId}/versions`,
      {
        baseVersion: 3,
        definition: { nodes: "nope" },
      }
    );
    expect(malformed.status).toBe(422);

    const renamed = await call(owner, "PATCH", `/api/flows/${flowId}`, {
      name: "Renamed",
      status: "ACTIVE",
    });
    expect(renamed.json.data).toMatchObject({
      name: "Renamed",
      status: "ACTIVE",
    });
    const listed = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/flows`
    );
    expect(listed.json.data.map(({ id }: { id: string }) => id)).toEqual([
      flowId,
    ]);
  });

  it("describes node types and validates a definition without saving it", async () => {
    const { owner } = await createTeam();
    const base = `/api/organizations/${owner.organizationId}/flows`;

    const nodeTypes = await call(owner, "GET", `${base}/node-types`);
    const types = nodeTypes.json.data as {
      configSchema: { required?: string[] };
      type: string;
    }[];
    expect(types.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "trigger.manual",
        "trigger.webhook",
        "trigger.schedule",
        "data.parseCsv",
        "logic.if",
        "shopify.findOrder",
        "shopify.addTags",
      ])
    );
    expect(
      types.find(({ type }) => type === "shopify.addTags")?.configSchema
        .required
    ).toEqual(["resourceId", "tags"]);

    const cyclic = csvFlow();
    cyclic.edges.push(edge("tag", "find"));
    cyclic.nodes.push(node("second", "trigger.manual"));
    const validation = await call(owner, "POST", `${base}/validate`, {
      definition: cyclic,
    });
    expect(validation.status).toBe(200);
    expect(validation.json.data.valid).toBe(false);
    expect(
      validation.json.data.issues.map(
        ({ code, nodeId }: { code: string; nodeId: string }) =>
          `${code}:${nodeId}`
      )
    ).toEqual(
      expect.arrayContaining([
        "CYCLE:find",
        "CYCLE:tag",
        "MULTIPLE_TRIGGERS:second",
      ])
    );
  });
});

describe("running flows", () => {
  it("lets a member upload a CSV, start a run and read its trace", async () => {
    const { flowId, member, organization, storeId } = await createTeam();
    const prefix = randomUUID().slice(0, 8);
    const uploaded = await upload(
      member,
      organization.organizationId,
      csvFile(seedOrders(prefix))
    );
    expect(uploaded.status).toBe(201);
    expect(uploaded.json.data).toMatchObject({ fileName: "orders.csv" });

    const started = await call(member, "POST", `/api/flows/${flowId}/runs`, {
      inputs: { csvFile: uploaded.json.data.id },
      storeId,
    });
    expect(started.status).toBe(201);
    const runId = started.json.data.id as string;
    await getJobProvider().waitUntilIdle();

    const detail = await call(member, "GET", `/api/flow-runs/${runId}`);
    expect(detail.json.data.run).toMatchObject({
      status: "SUCCEEDED",
      triggerType: "manual",
    });
    expect(detail.json.data.version.version).toBe(2);
    expect(detail.json.data.nodes.find).toMatchObject({
      counts: { SUCCEEDED: 3 },
      step: { status: "SUCCEEDED" },
    });
    expect(detail.json.data.nodes.tag.counts).toEqual({ SUCCEEDED: 2 });
    expect(server.order(`gid://shopify/Order/${prefix}-1`)?.tags).toEqual([
      "high-value",
    ]);
    expect(server.order(`gid://shopify/Order/${prefix}-2`)?.tags).toEqual([]);

    const firstPage = await call(
      member,
      "GET",
      `/api/flow-runs/${runId}/items?nodeId=find&limit=2`
    );
    expect(firstPage.json.data).toHaveLength(2);
    expect(firstPage.json.data[0]).toMatchObject({
      input: { Order: `#${prefix}-1` },
      itemKey: "0.0",
      nodeId: "find",
      status: "SUCCEEDED",
    });
    const secondPage = await call(
      member,
      "GET",
      `/api/flow-runs/${runId}/items?nodeId=find&limit=2&cursor=${firstPage.json.pageInfo.nextCursor}`
    );
    expect(secondPage.json.data).toHaveLength(1);
    expect(secondPage.json.pageInfo.nextCursor).toBeNull();
    const failed = await call(
      member,
      "GET",
      `/api/flow-runs/${runId}/items?status=FAILED`
    );
    expect(failed.json.data).toEqual([]);

    const runs = await call(member, "GET", `/api/flows/${flowId}/runs`);
    expect(runs.json.data.map(({ id }: { id: string }) => id)).toEqual([runId]);
    const cancel = await call(member, "POST", `/api/flow-runs/${runId}/cancel`);
    expect(cancel.status).toBe(409);
  });

  it("rejects a store or file from another organization and unsuitable uploads", async () => {
    const { flowId, organization, owner, storeId } = await createTeam();
    const other = await createTeam();
    const ownFile = await upload(
      owner,
      organization.organizationId,
      csvFile("Order,Total\n")
    );
    const foreignFile = await upload(
      other.owner,
      other.organization.organizationId,
      csvFile("Order,Total\n")
    );
    const start = (body: Record<string, unknown>) =>
      call(owner, "POST", `/api/flows/${flowId}/runs`, body);

    const foreignStore = await start({
      inputs: { csvFile: ownFile.json.data.id },
      storeId: other.storeId,
    });
    expect(foreignStore.status).toBe(422);
    expect(foreignStore.json.error.details.reason).toBe("STORE_NOT_AVAILABLE");

    const foreignAsset = await start({
      inputs: { csvFile: foreignFile.json.data.id },
      storeId,
    });
    expect(foreignAsset.status).toBe(422);
    expect(foreignAsset.json.error.details.reason).toBe("INPUT_INVALID");
    expect((await start({ storeId })).status).toBe(422);
    await expect(prisma.flowRun.count({ where: { flowId } })).resolves.toBe(0);

    const notCsv = await upload(
      owner,
      organization.organizationId,
      new File(["<html></html>"], "page.html", { type: "text/html" })
    );
    expect(notCsv.status).toBe(422);
    const binary = await upload(
      owner,
      organization.organizationId,
      new File([new Uint8Array([80, 75, 3, 4, 0, 0])], "archive.csv", {
        type: "text/csv",
      })
    );
    expect(binary.status).toBe(422);
    const tooLarge = await upload(
      owner,
      organization.organizationId,
      csvFile("a".repeat(10_000_001))
    );
    expect(tooLarge.status).toBe(422);
    const elsewhere = await upload(
      owner,
      other.organization.organizationId,
      csvFile("Order,Total\n")
    );
    expect(elsewhere.status).toBe(403);
  });

  it("refuses to run a flow that has validation issues", async () => {
    const { flowId, organization, owner, storeId } = await createTeam();
    const draft = csvFlow();
    draft.nodes.push(
      node("orphan", "shopify.addTags", { resourceId: "x", tags: ["t"] })
    );
    await call(owner, "POST", `/api/flows/${flowId}/versions`, {
      baseVersion: 2,
      definition: draft,
    });
    const file = await upload(
      owner,
      organization.organizationId,
      csvFile("Order,Total\n")
    );

    const response = await call(owner, "POST", `/api/flows/${flowId}/runs`, {
      inputs: { csvFile: file.json.data.id },
      storeId,
    });

    expect(response.status).toBe(422);
    expect(response.json.error.details).toMatchObject({
      issues: [
        expect.objectContaining({ code: "UNREACHABLE", nodeId: "orphan" }),
      ],
      reason: "FLOW_INVALID",
    });
  });
});

describe("flow access control", () => {
  it("lets a member run but not author, and a viewer only read", async () => {
    const { flowId, member, organization, storeId, viewer } =
      await createTeam();
    const base = `/api/organizations/${organization.organizationId}/flows`;
    const reader = await createActorWithPermissions(
      organization.organizationId,
      [{ action: "read", module: "flows" }]
    );
    const file = await upload(
      member,
      organization.organizationId,
      csvFile("Order,Total\n")
    );

    for (const actor of [member, viewer, reader]) {
      const reads = await Promise.all([
        call(actor, "GET", base),
        call(actor, "GET", `${base}/node-types`),
        call(actor, "GET", `/api/flows/${flowId}`),
        call(actor, "GET", `/api/flows/${flowId}/runs`),
      ]);
      expect(reads.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    }

    for (const actor of [member, viewer]) {
      const authoring = [
        await call(actor, "POST", base, { name: "Mine" }),
        await call(actor, "PATCH", `/api/flows/${flowId}`, { name: "Mine" }),
        await call(actor, "POST", `/api/flows/${flowId}/versions`, {
          baseVersion: 2,
          definition: csvFlow(),
        }),
        await call(actor, "POST", `${base}/validate`, {
          definition: csvFlow(),
        }),
      ];
      expect(authoring.map(({ status }) => status)).toEqual([
        403, 403, 403, 403,
      ]);
    }

    for (const actor of [viewer, reader]) {
      const start = await call(actor, "POST", `/api/flows/${flowId}/runs`, {
        inputs: { csvFile: file.json.data.id },
        storeId,
      });
      expect(start.status).toBe(403);
      expect(
        (await upload(actor, organization.organizationId, csvFile("Order\n")))
          .status
      ).toBe(403);
    }
    await expect(prisma.flowRun.count({ where: { flowId } })).resolves.toBe(0);

    const started = await call(member, "POST", `/api/flows/${flowId}/runs`, {
      inputs: { csvFile: file.json.data.id },
      storeId,
    });
    expect(started.status).toBe(201);
    await getJobProvider().waitUntilIdle();
    const runId = started.json.data.id as string;
    expect((await call(viewer, "GET", `/api/flow-runs/${runId}`)).status).toBe(
      200
    );
    expect(
      (await call(viewer, "POST", `/api/flow-runs/${runId}/cancel`)).status
    ).toBe(403);
  });

  it("answers 404 to another organization for flows and runs", async () => {
    const { flowId, member, organization, owner, storeId } = await createTeam();
    const outsider = await createActor("Owner");
    const file = await upload(
      member,
      organization.organizationId,
      csvFile("Order,Total\n")
    );
    const started = await call(member, "POST", `/api/flows/${flowId}/runs`, {
      inputs: { csvFile: file.json.data.id },
      storeId,
    });
    await getJobProvider().waitUntilIdle();
    const runId = started.json.data.id as string;

    const responses = [
      await call(outsider, "GET", `/api/flows/${flowId}`),
      await call(outsider, "PATCH", `/api/flows/${flowId}`, { name: "Taken" }),
      await call(outsider, "POST", `/api/flows/${flowId}/versions`, {
        baseVersion: 2,
        definition: csvFlow(),
      }),
      await call(outsider, "POST", `/api/flows/${flowId}/runs`, { storeId }),
      await call(outsider, "GET", `/api/flows/${flowId}/runs`),
      await call(outsider, "GET", `/api/flow-runs/${runId}`),
      await call(outsider, "GET", `/api/flow-runs/${runId}/items`),
      await call(outsider, "POST", `/api/flow-runs/${runId}/cancel`),
      await call(outsider, "GET", "/api/flows/does-not-exist"),
    ];
    expect(responses.map(({ status }) => status)).toEqual(
      Array.from({ length: 9 }, () => 404)
    );
    const foreignList = await call(
      outsider,
      "GET",
      `/api/organizations/${owner.organizationId}/flows`
    );
    expect(foreignList.status).toBe(403);
    expect((await call(null, "GET", `/api/flows/${flowId}`)).status).toBe(401);
  });

  it("refuses writes sent from another origin, uploads included", async () => {
    const { flowId, organization, owner, storeId } = await createTeam();
    const foreign = { origin: "https://evil.example" };

    const start = await call(
      owner,
      "POST",
      `/api/flows/${flowId}/runs`,
      { storeId },
      foreign
    );
    const create = await call(
      owner,
      "POST",
      `/api/organizations/${organization.organizationId}/flows`,
      { name: "Injected" },
      foreign
    );
    const uploaded = await upload(
      owner,
      organization.organizationId,
      csvFile("Order,Total\n"),
      foreign
    );

    expect([start.status, create.status, uploaded.status]).toEqual([
      403, 403, 403,
    ]);
    await expect(
      prisma.fileAsset.count({
        where: { organizationId: organization.organizationId },
      })
    ).resolves.toBe(0);
  });
});

describe("secrets", () => {
  it("never put the store token in a response body", () => {
    expect(responseBodies.length).toBeGreaterThan(60);
    expect(responseBodies.filter((body) => body.includes(STORE_TOKEN))).toEqual(
      []
    );
  });
});
