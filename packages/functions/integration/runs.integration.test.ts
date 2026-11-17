import { prisma } from "@repo/database";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type CodeFunctionRunRecord,
  cancelRun,
  createFunction,
  failInterruptedRuns,
  getRun,
  listRuns,
  startRun,
} from "../src";
import { FUNCTION_LIMITS } from "../src/definition";
import { type FakeRunner, fakeExit } from "../src/testing/fake-runner";
import {
  auditText,
  connectRunner,
  createOrganization,
  failureOf,
  UNREACHABLE_URL,
  useFakeRunner,
} from "./support";

let organization: Awaited<ReturnType<typeof createOrganization>>;
let fake: FakeRunner;
let functionId: string;

beforeAll(async () => {
  organization = await createOrganization();
  fake = await useFakeRunner();
  const fn = await createFunction({
    actorId: organization.actorId,
    name: "Runs",
    organizationId: organization.organizationId,
    runtime: "NODE",
  });
  functionId = fn.id;
});

afterEach(() => {
  fake.reset();
  connectRunner(fake.url, fake.token);
});

afterAll(async () => {
  await organization?.cleanup();
  await fake?.close();
});

const run = (params: Record<string, unknown> = { name: "ada", times: 2 }) =>
  startRun({
    actorId: organization.actorId,
    functionId,
    organizationId: organization.organizationId,
    params,
    trigger: "MANUAL",
  });

describe("running a function", () => {
  it("records output, result and timing of a successful run", async () => {
    const { completion, run: queued } = await run();
    expect(queued.status).toBe("QUEUED");

    const finished = await completion;

    expect(finished).toMatchObject({
      durationMs: 5,
      error: null,
      exitCode: 0,
      output: "hello\n",
      outputTruncated: false,
      params: { name: "ada", times: 2 },
      result: { ok: true },
      startedById: organization.actorId,
      status: "SUCCEEDED",
      trigger: "MANUAL",
    });
    expect(finished.startedAt).not.toBeNull();
    expect(finished.finishedAt).not.toBeNull();
    expect(fake.state.requests.at(-1)).toMatchObject({
      paramOrder: ["name", "times"],
      runId: queued.id,
      runtime: "NODE",
      timeoutSeconds: 60,
    });
  });

  it("records each way a run can end", async () => {
    const endings = [
      fakeExit({ error: "boom", exitCode: 1, status: "FAILED" }),
      fakeExit({
        error: "The function timed out after 60 seconds.",
        exitCode: 137,
        status: "TIMED_OUT",
      }),
      fakeExit({
        error: "The function exceeded its 256 MB memory limit.",
        exitCode: 137,
        oomKilled: true,
        status: "FAILED",
      }),
      fakeExit({ result: null }),
    ];
    const finished: CodeFunctionRunRecord[] = [];
    for (const ending of endings) {
      fake.state.script = function* () {
        yield ending;
      };
      finished.push(await (await run()).completion);
    }

    expect(
      finished.map(({ error, result, status }) => ({ error, result, status }))
    ).toEqual([
      { error: "boom", result: null, status: "FAILED" },
      {
        error: "The function timed out after 60 seconds.",
        result: null,
        status: "TIMED_OUT",
      },
      {
        error: "The function exceeded its 256 MB memory limit.",
        result: null,
        status: "FAILED",
      },
      { error: null, result: null, status: "SUCCEEDED" },
    ]);
  });

  it("keeps at most 1 MB of output", async () => {
    const chunk = "x".repeat(64 * 1024);
    fake.state.script = function* () {
      for (let index = 0; index < 24; index += 1) {
        yield { data: chunk, stream: "stdout", type: "output" };
      }
      yield fakeExit();
    };

    const finished = await (await run()).completion;

    expect(finished.outputTruncated).toBe(true);
    expect(Buffer.byteLength(finished.output)).toBe(
      FUNCTION_LIMITS.outputBytes
    );
  });

  it("asks the runner to stop a canceled run", async () => {
    fake.state.script = async function* ({ canceled }) {
      yield { type: "started" };
      yield { data: "working\n", stream: "stdout", type: "output" };
      await canceled;
      yield fakeExit({ exitCode: 137, status: "CANCELED" });
    };
    const { completion, run: queued } = await run();
    await waitFor(() => fake.state.requests.some((r) => r.runId === queued.id));

    await cancelRun({
      actorId: organization.actorId,
      organizationId: organization.organizationId,
      runId: queued.id,
    });
    const finished = await completion;

    expect(fake.state.canceledRunIds).toContain(queued.id);
    expect(finished.status).toBe("CANCELED");
    expect(finished.cancelRequestedAt).not.toBeNull();
    expect(
      (
        await failureOf(
          cancelRun({
            actorId: organization.actorId,
            organizationId: organization.organizationId,
            runId: queued.id,
          })
        )
      ).failure
    ).toBe("RUN_NOT_ACTIVE");
  });

  it("fails a run the runner cannot take", async () => {
    fake.state.refuseWith = 429;
    const busy = await (await run()).completion;
    expect(busy).toMatchObject({ status: "FAILED" });
    expect(busy.error).toContain("busy");

    fake.reset();
    connectRunner(UNREACHABLE_URL, fake.token);
    const unreachable = await (await run()).completion;
    expect(unreachable).toMatchObject({ status: "FAILED" });
    expect(unreachable.error).toContain("unavailable");
  });

  it("refuses parameters that do not match main", async () => {
    const before = (
      await listRuns({
        functionId,
        organizationId: organization.organizationId,
      })
    ).runs.length;

    const error = await failureOf(run({ times: "two" }));

    expect(error.failure).toBe("PARAMS_INVALID");
    expect(error.message).toContain("name is required");
    expect(error.message).toContain("times must be a number");
    expect(
      (
        await listRuns({
          functionId,
          organizationId: organization.organizationId,
        })
      ).runs
    ).toHaveLength(before);
  });

  it("never writes parameter values to the audit log", async () => {
    await (
      await run({ name: "param-value-that-must-not-be-audited", times: 1 })
    ).completion;

    const audit = await auditText(organization.organizationId);
    expect(audit).toContain("function.run.started");
    expect(audit).not.toContain("param-value-that-must-not-be-audited");
  });
});

describe("run history", () => {
  it("lists runs newest first, without output, a page at a time", async () => {
    const scope = { functionId, organizationId: organization.organizationId };
    const first = await listRuns(scope, { limit: 2 });

    expect(first.runs).toHaveLength(2);
    expect(first.runs[0]?.number).toBeGreaterThan(first.runs[1]?.number ?? 0);
    expect(first.runs[0]).not.toHaveProperty("output");
    const second = await listRuns(scope, {
      cursor: first.nextCursor ?? "",
      limit: 2,
    });
    expect(second.runs[0]?.number).toBe((first.runs[1]?.number ?? 0) - 1);
  });

  it("keeps the newest 200 runs of a function", async () => {
    const fn = await createFunction({
      actorId: organization.actorId,
      name: "Pruned",
      organizationId: organization.organizationId,
      runtime: "NODE",
    });
    await prisma.codeFunctionRun.createMany({
      data: Array.from({ length: FUNCTION_LIMITS.runsKept }, (_, index) => ({
        functionId: fn.id,
        number: index + 1,
        organizationId: organization.organizationId,
        params: {},
        sourceHash: fn.sourceHash,
        status: "SUCCEEDED" as const,
        trigger: "MANUAL" as const,
      })),
    });

    await (
      await startRun({
        functionId: fn.id,
        organizationId: organization.organizationId,
        params: { name: "x", times: 1 },
        trigger: "MANUAL",
      })
    ).completion;

    const numbers = (
      await prisma.codeFunctionRun.findMany({
        orderBy: { number: "asc" },
        select: { number: true },
        where: { functionId: fn.id },
      })
    ).map(({ number }) => number);
    expect(numbers).toHaveLength(FUNCTION_LIMITS.runsKept);
    expect(numbers[0]).toBe(2);
    expect(numbers.at(-1)).toBe(FUNCTION_LIMITS.runsKept + 1);
  });

  it("fails runs a stopped server left behind", async () => {
    const orphan = await prisma.codeFunctionRun.create({
      data: {
        functionId,
        number: 10_000,
        organizationId: organization.organizationId,
        params: {},
        sourceHash: "x",
        status: "RUNNING",
        trigger: "SCHEDULE",
      },
    });

    expect(await failInterruptedRuns()).toBeGreaterThanOrEqual(1);
    expect(
      await getRun({
        organizationId: organization.organizationId,
        runId: orphan.id,
      })
    ).toMatchObject({ status: "FAILED" });
  });
});

const waitFor = async (condition: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for a condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
