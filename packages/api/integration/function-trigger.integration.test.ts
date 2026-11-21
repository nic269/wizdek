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

const WAIT_MS = 300;
const SECRET = "variable-secret-1234";
const SECONDS = /^\d+$/;

const { call, cleanup, createActor, responseBodies } = createApiHarness({
  functionTrigger: { waitMs: WAIT_MS },
});

let fake: FakeRunner;
let owner: Actor;

beforeAll(async () => {
  fake = await startFakeRunner();
  process.env.FUNCTIONS_RUNNER_URL = fake.url;
  process.env.FUNCTIONS_RUNNER_TOKEN = fake.token;
  owner = await createActor("Owner");
});

afterEach(() => {
  fake.reset();
});

afterAll(async () => {
  await cleanup();
  await fake?.close();
});

/** A function with its trigger on; resolves with its id and token. */
const triggerable = async (name: string) => {
  const fn = (
    await call(
      owner,
      "POST",
      `/api/organizations/${owner.organizationId}/functions`,
      { name, runtime: "NODE" }
    )
  ).json.data;
  const enabled = await call(
    owner,
    "POST",
    `/api/functions/${fn.id}/http/enable`
  );
  expect(enabled.status).toBe(200);
  return { id: fn.id as string, token: enabled.json.data.token as string };
};

/** Calls the public trigger with no session, as an outside caller would. */
const rawInvoke = async (
  functionId: string,
  headers: Record<string, string>,
  body: string
) => {
  const { createApiApp } = await import("../src/app");
  const response = await createApiApp({
    functionTrigger: { waitMs: WAIT_MS },
  }).request(`/api/fn/${functionId}`, {
    body,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
  const text = await response.text();
  return { response, text };
};

const runCount = (functionId: string) =>
  prisma.codeFunctionRun.count({ where: { functionId } });

describe("the public HTTP trigger", () => {
  it("runs the function with the body as params and answers its result", async () => {
    const { id, token } = await triggerable("Trigger result");

    const { response, text } = await rawInvoke(
      id,
      { "x-function-token": token },
      JSON.stringify({ name: "from http" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = JSON.parse(text);
    expect(body).toMatchObject({
      result: { ok: true },
      status: "SUCCEEDED",
    });
    expect(body).not.toHaveProperty("output");
    expect(fake.state.requests.at(-1)?.params).toEqual({ name: "from http" });
    const run = await prisma.codeFunctionRun.findUniqueOrThrow({
      where: { id: body.runId },
    });
    expect(run.trigger).toBe("HTTP");

    const bearer = await rawInvoke(
      id,
      { authorization: `Bearer ${token}` },
      JSON.stringify({ name: "bearer" })
    );
    expect(bearer.response.status).toBe(200);
  });

  it("answers 401 with an empty body, and starts nothing, without the right token", async () => {
    const { id, token } = await triggerable("Trigger refusals");
    const other = await triggerable("Trigger other");
    const body = JSON.stringify({ name: "x" });

    const attempts = [
      await rawInvoke(id, {}, body),
      await rawInvoke(id, { "x-function-token": `${token}x` }, body),
      await rawInvoke(id, { "x-function-token": other.token }, body),
      await rawInvoke("unknown-function", { "x-function-token": token }, body),
    ];
    await call(owner, "POST", `/api/functions/${id}/http/disable`);
    attempts.push(await rawInvoke(id, { "x-function-token": token }, body));

    for (const { response, text } of attempts) {
      expect(response.status).toBe(401);
      expect(text).toBe("");
    }
    expect(await runCount(id)).toBe(0);
  });

  it("refuses large bodies, bad params and callers over the rate limit", async () => {
    const { id, token } = await triggerable("Trigger limits");
    const headers = { "x-function-token": token };

    const large = await rawInvoke(
      id,
      headers,
      JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) })
    );
    expect(large.response.status).toBe(413);

    const notJson = await rawInvoke(id, headers, "[1, 2]");
    expect(notJson.response.status).toBe(422);
    const badParams = await rawInvoke(id, headers, JSON.stringify({}));
    expect(badParams.response.status).toBe(422);
    expect(JSON.parse(badParams.text).error).toContain("name");

    // One app, so the limiter's window is shared by every call.
    const { createApiApp } = await import("../src/app");
    const app = createApiApp({ functionTrigger: { waitMs: WAIT_MS } });
    fake.state.script = function* () {
      yield { type: "started" };
      yield fakeExit({ result: 1 });
    };
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      const response = await app.request(`/api/fn/${id}`, {
        body: JSON.stringify({ name: "x" }),
        headers: { "content-type": "application/json", ...headers },
        method: "POST",
      });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toMatch(SECONDS);
      }
    }
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("answers 202 with the run id when the run outlasts the wait, then reports it", async () => {
    const { id, token } = await triggerable("Trigger slow");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.state.script = async function* () {
      yield { type: "started" };
      await gate;
      yield fakeExit({ result: { late: true } });
    };

    const { response, text } = await rawInvoke(
      id,
      { "x-function-token": token },
      JSON.stringify({ name: "slow" })
    );
    expect(response.status).toBe(202);
    const { runId } = JSON.parse(text);

    const status = (headers: Record<string, string>) =>
      call(null, "GET", `/api/fn/${id}/runs/${runId}`, undefined, headers);
    expect((await status({})).status).toBe(401);

    release();
    const deadline = Date.now() + 5000;
    let latest = await status({ "x-function-token": token });
    while (latest.json.status !== "SUCCEEDED" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      latest = await status({ "x-function-token": token });
    }
    expect(latest.status).toBe(200);
    expect(latest.json).toMatchObject({
      result: { late: true },
      runId,
      status: "SUCCEEDED",
    });
  });

  it("answers 503 with Retry-After when the runner is full", async () => {
    const { id, token } = await triggerable("Trigger busy");
    fake.state.refuseWith = 429;
    const { response } = await rawInvoke(
      id,
      { "x-function-token": token },
      JSON.stringify({ name: "x" })
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("10");
  });

  it("shows the token once and never returns variable values", async () => {
    const { id, token } = await triggerable("Trigger secrets");
    await call(owner, "PUT", `/api/functions/${id}/env/API_KEY`, {
      value: SECRET,
    });
    const listed = await call(owner, "GET", `/api/functions/${id}/env`);
    expect(listed.json.data).toEqual([
      { name: "API_KEY", updatedAt: expect.any(String) },
    ]);
    const fn = await call(owner, "GET", `/api/functions/${id}`);
    expect(fn.json.data.httpTrigger).toEqual({
      enabled: true,
      tokenHint: token.slice(-4),
    });

    const bodies = responseBodies.join("\n");
    expect(bodies).not.toContain(SECRET);
    // Only the enable response carried the token.
    expect(bodies.split(token).length - 1).toBe(1);
  });
});
