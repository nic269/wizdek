import { prisma } from "@repo/database";
import {
  type FakeRunner,
  fakeExit,
  startFakeRunner,
} from "@repo/functions/testing";
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

const { call, cleanup, createActor, createOrganization, responseBodies } =
  createApiHarness();

let fake: FakeRunner;
let owner: Actor;
let member: Actor;
let viewer: Actor;
let outsider: Actor;

const enableRunner = () => {
  process.env.FUNCTIONS_RUNNER_URL = fake.url;
  process.env.FUNCTIONS_RUNNER_TOKEN = fake.token;
};

const disableRunner = () => {
  process.env.FUNCTIONS_RUNNER_URL = "";
  process.env.FUNCTIONS_RUNNER_TOKEN = "";
};

const createFunction = (actor: Actor, name: string, runtime = "NODE") =>
  call(actor, "POST", `/api/organizations/${actor.organizationId}/functions`, {
    name,
    runtime,
  });

const waitForRun = async (actor: Actor, runId: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await call(actor, "GET", `/api/function-runs/${runId}`);
    if (!["QUEUED", "RUNNING"].includes(response.json.data.status)) {
      return response.json.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The run did not finish in time.");
};

beforeAll(async () => {
  fake = await startFakeRunner();
  const organization = await createOrganization();
  owner = await createActor("Owner", organization);
  member = await createActor("Member", organization);
  viewer = await createActor("Viewer", organization);
  outsider = await createActor("Owner");
});

afterEach(() => {
  fake.reset();
  enableRunner();
});

afterAll(async () => {
  await cleanup();
  await fake?.close();
});

describe("functions while the runner is not configured", () => {
  it("reports the feature as off but still lists and edits functions", async () => {
    disableRunner();

    const status = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/functions/status`
    );
    expect(status.status).toBe(200);
    expect(status.json.data).toMatchObject({
      enabled: false,
      reachable: false,
    });

    const created = await createFunction(owner, "Offline");
    expect(created.status).toBe(201);
    expect(created.json.data.paramsStale).toBe(true);

    const listed = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/functions`
    );
    expect(listed.json.data.map((fn: { name: string }) => fn.name)).toContain(
      "Offline"
    );

    const run = await call(
      owner,
      "POST",
      `/api/functions/${created.json.data.id}/runs`,
      { params: {} }
    );
    expect(run.status).toBe(409);
    expect(run.json.error.details.reason).toBe("FUNCTIONS_DISABLED");
  });
});

describe("a function's life cycle", () => {
  it("creates, saves, runs, polls and cancels", async () => {
    const status = await call(
      owner,
      "GET",
      `/api/organizations/${owner.organizationId}/functions/status`
    );
    expect(status.json.data).toMatchObject({ enabled: true, reachable: true });

    const created = await createFunction(owner, "Cycle");
    expect(created.status).toBe(201);
    const fn = created.json.data;
    expect(fn.files.map((file: { path: string }) => file.path)).toEqual([
      "index.ts",
    ]);

    const saved = await call(owner, "PUT", `/api/functions/${fn.id}/files`, {
      baseHash: fn.sourceHash,
      files: [
        {
          content: "export function main(orderId: string, limit: number) {}",
          path: "index.ts",
        },
        { content: "export const x = 1;", path: "lib/util.ts" },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.json.data.paramsSchema["x-order"]).toEqual([
      "orderId",
      "limit",
    ]);

    const stale = await call(owner, "PUT", `/api/functions/${fn.id}/files`, {
      baseHash: fn.sourceHash,
      files: [{ content: "lost", path: "index.ts" }],
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.reason).toBe("SOURCE_CONFLICT");

    const invalid = await call(owner, "POST", `/api/functions/${fn.id}/runs`, {
      params: { orderId: 5 },
    });
    expect(invalid.status).toBe(422);

    const started = await call(owner, "POST", `/api/functions/${fn.id}/runs`, {
      params: { limit: 3, orderId: "#1001" },
    });
    expect(started.status).toBe(201);
    const finished = await waitForRun(owner, started.json.data.id);
    expect(finished).toMatchObject({
      number: 1,
      output: "hello\n",
      outputLength: 6,
      params: { limit: 3, orderId: "#1001" },
      result: { ok: true },
      status: "SUCCEEDED",
      trigger: "MANUAL",
    });
    expect(finished.startedByName).toBe("owner");

    const tail = await call(
      owner,
      "GET",
      `/api/function-runs/${started.json.data.id}?outputOffset=4`
    );
    expect(tail.json.data).toMatchObject({ output: "o\n", outputLength: 6 });

    fake.state.script = async function* (context) {
      yield { type: "started" };
      await context.canceled;
      yield fakeExit({ exitCode: 137, status: "CANCELED" });
    };
    const long = await call(owner, "POST", `/api/functions/${fn.id}/runs`, {
      params: { limit: 1, orderId: "#2" },
    });
    const deadline = Date.now() + 5000;
    while (
      !fake.state.requests.some(
        (request) => request.runId === long.json.data.id
      )
    ) {
      if (Date.now() > deadline) {
        throw new Error("The run never reached the runner.");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const canceled = await call(
      owner,
      "POST",
      `/api/function-runs/${long.json.data.id}/cancel`
    );
    expect(canceled.status).toBe(200);
    expect((await waitForRun(owner, long.json.data.id)).status).toBe(
      "CANCELED"
    );

    const runs = await call(owner, "GET", `/api/functions/${fn.id}/runs`);
    expect(runs.json.data.map((run: { number: number }) => run.number)).toEqual(
      [2, 1]
    );
    expect(runs.json.data[0]).not.toHaveProperty("output");

    const updated = await call(owner, "PATCH", `/api/functions/${fn.id}`, {
      memoryMb: 512,
      name: "Cycle renamed",
    });
    expect(updated.json.data).toMatchObject({
      memoryMb: 512,
      name: "Cycle renamed",
    });
    expect(updated.json.data.files).toHaveLength(2);

    const deleted = await call(owner, "DELETE", `/api/functions/${fn.id}`);
    expect(deleted.status).toBe(200);
    expect((await call(owner, "GET", `/api/functions/${fn.id}`)).status).toBe(
      404
    );
  });
});

describe("packages", () => {
  const waitForPackages = async (actor: Actor, functionId: string) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const response = await call(actor, "GET", `/api/functions/${functionId}`);
      if (response.json.data.depsStatus !== "BUILDING") {
        return response.json.data;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("The packages did not finish installing in time.");
  };

  it("installs on save, refuses runs until ready and installs again on request", async () => {
    const fn = (await createFunction(owner, "Packages")).json.data;
    expect(fn).toMatchObject({ depsLog: "", depsStatus: "NONE" });
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const script = fake.state.depsScript;
    fake.state.depsScript = async function* (request) {
      await gate;
      yield* script(request);
    };

    const saved = await call(owner, "PUT", `/api/functions/${fn.id}/files`, {
      baseHash: fn.sourceHash,
      files: [
        ...fn.files,
        { content: '{"dependencies":{"ms":"2.1.3"}}', path: "package.json" },
      ],
    });
    expect(saved.json.data.depsStatus).toBe("BUILDING");
    const refused = await call(owner, "POST", `/api/functions/${fn.id}/runs`, {
      params: { name: "x", times: 1 },
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error.details.reason).toBe("DEPS_NOT_READY");

    finish();
    const ready = await waitForPackages(owner, fn.id);
    expect(ready).toMatchObject({
      depsError: null,
      depsLog: "added 1 package\n",
      depsStatus: "READY",
    });
    expect(ready).not.toHaveProperty("depsKey");

    const again = await call(
      owner,
      "POST",
      `/api/functions/${fn.id}/deps/rebuild`
    );
    expect(again.status).toBe(200);
    expect(again.json.data.depsStatus).toBe("BUILDING");
    expect((await waitForPackages(owner, fn.id)).depsStatus).toBe("READY");
  });
});

describe("authorization", () => {
  it("keeps every route to members with the functions permissions", async () => {
    const fn = (await createFunction(owner, "Guarded")).json.data;
    const run = (
      await call(owner, "POST", `/api/functions/${fn.id}/runs`, {
        params: { name: "x", times: 1 },
      })
    ).json.data;
    await waitForRun(owner, run.id);
    // Written directly: the test API has no durable job queue to register it.
    const schedule = await prisma.codeFunctionSchedule.create({
      data: {
        cron: "0 * * * *",
        enabled: false,
        functionId: fn.id,
        params: {},
        timezone: "UTC",
      },
    });

    const organizationPath = `/api/organizations/${owner.organizationId}/functions`;
    const requests: [string, string, unknown?][] = [
      ["GET", organizationPath],
      ["GET", `${organizationPath}/status`],
      ["POST", organizationPath, { name: "Nope", runtime: "NODE" }],
      ["GET", `/api/functions/${fn.id}`],
      ["PATCH", `/api/functions/${fn.id}`, { name: "Nope" }],
      [
        "PUT",
        `/api/functions/${fn.id}/files`,
        { baseHash: fn.sourceHash, files: [{ content: "", path: "index.ts" }] },
      ],
      ["POST", `/api/functions/${fn.id}/deps/rebuild`],
      ["GET", `/api/functions/${fn.id}/runs`],
      ["POST", `/api/functions/${fn.id}/runs`, { params: {} }],
      ["GET", `/api/function-runs/${run.id}`],
      ["POST", `/api/function-runs/${run.id}/cancel`],
      ["GET", `/api/functions/${fn.id}/env`],
      ["PUT", `/api/functions/${fn.id}/env/API_KEY`, { value: "secret-value" }],
      ["DELETE", `/api/functions/${fn.id}/env/API_KEY`],
      ["POST", `/api/functions/${fn.id}/http/enable`],
      ["POST", `/api/functions/${fn.id}/http/rotate`],
      ["POST", `/api/functions/${fn.id}/http/disable`],
      ["GET", `/api/functions/${fn.id}/schedules`],
      [
        "POST",
        `/api/functions/${fn.id}/schedules`,
        { cron: "0 * * * *", params: { name: "x" } },
      ],
      ["PATCH", `/api/function-schedules/${schedule.id}`, { enabled: false }],
      ["DELETE", `/api/function-schedules/${schedule.id}`],
      ["DELETE", `/api/functions/${fn.id}`],
    ];

    for (const actor of [member, viewer]) {
      for (const [method, path, body] of requests) {
        const response = await call(actor, method, path, body);
        expect(response.status, `${method} ${path}`).toBe(403);
      }
    }
    for (const [method, path, body] of requests) {
      const response = await call(outsider, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(
        path.startsWith("/api/organizations/") ? 403 : 404
      );
    }
    expect((await call(owner, "GET", `/api/functions/${fn.id}`)).status).toBe(
      200
    );
  });

  it("refuses writes sent from another site", async () => {
    const fn = (await createFunction(owner, "Origin")).json.data;
    const foreign = { origin: "https://attacker.example" };
    const writes: [string, string, unknown][] = [
      [
        "POST",
        `/api/organizations/${owner.organizationId}/functions`,
        { name: "Foreign", runtime: "NODE" },
      ],
      ["PATCH", `/api/functions/${fn.id}`, { name: "Foreign" }],
      [
        "PUT",
        `/api/functions/${fn.id}/files`,
        { baseHash: fn.sourceHash, files: [{ content: "", path: "index.ts" }] },
      ],
      ["POST", `/api/functions/${fn.id}/runs`, { params: {} }],
      ["POST", `/api/functions/${fn.id}/deps/rebuild`, {}],
      ["POST", "/api/function-runs/any/cancel", {}],
      ["PUT", `/api/functions/${fn.id}/env/API_KEY`, { value: "foreign" }],
      ["POST", `/api/functions/${fn.id}/http/enable`, {}],
      ["POST", `/api/functions/${fn.id}/schedules`, { cron: "0 * * * *" }],
      ["PATCH", "/api/function-schedules/any", { enabled: false }],
      ["DELETE", `/api/functions/${fn.id}`, undefined],
    ];

    for (const [method, path, body] of writes) {
      const response = await call(owner, method, path, body, foreign);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("never returns the runner's address or token", () => {
    const seen = responseBodies.join("\n");
    expect(seen).not.toContain(fake.token);
    expect(seen).not.toContain(fake.url);
  });
});
