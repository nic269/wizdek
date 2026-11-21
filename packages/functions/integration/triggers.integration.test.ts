import { prisma } from "@repo/database";
import {
  createLocalJobProvider,
  type JobQueueProvider,
  type ScheduleJobInput,
} from "@repo/jobs";
import { createPgBossJobProvider } from "@repo/jobs/pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  authenticateTrigger,
  createFunction,
  createFunctionScheduleJob,
  createSchedule,
  deleteEnvVar,
  deleteSchedule,
  disableHttpTrigger,
  enableHttpTrigger,
  FUNCTION_SCHEDULE_JOB,
  getFunction,
  invokeFunction,
  listEnvVars,
  listSchedules,
  rotateHttpToken,
  saveFiles,
  setEnvVar,
  startRun,
  updateSchedule,
} from "../src";
import { type FakeRunner, fakeExit } from "../src/testing/fake-runner";
import {
  auditText,
  connectRunner,
  createOrganization,
  failureOf,
  useFakeRunner,
} from "./support";

const SECRET = "sk_test_9f8e7d6c5b4a";
const TOKEN_FORMAT = /^wfn_[\w-]{43}$/;
/** The starter `main` takes a name. */
const STARTER_PARAMS = { name: "test" };

let organization: Awaited<ReturnType<typeof createOrganization>>;
let fake: FakeRunner;

beforeAll(async () => {
  organization = await createOrganization();
  fake = await useFakeRunner();
});

afterEach(() => {
  fake.reset();
  connectRunner(fake.url, fake.token);
});

afterAll(async () => {
  await organization?.cleanup();
  await fake?.close();
});

const scopeOf = (functionId: string) => ({
  functionId,
  organizationId: organization.organizationId,
});

const newFunction = (name: string) =>
  createFunction({
    actorId: organization.actorId,
    name,
    organizationId: organization.organizationId,
    runtime: "NODE",
  });

/** A function whose `main` takes `limit: number = 10`. */
const functionWithParams = async (name: string) => {
  const fn = await newFunction(name);
  await saveFiles({
    ...scopeOf(fn.id),
    actorId: organization.actorId,
    expectedHash: fn.sourceHash,
    files: [
      {
        content: "export function main(limit: number = 10) { return limit; }",
        path: "index.ts",
      },
    ],
  });
  return getFunction(scopeOf(fn.id));
};

/** Records what is scheduled, as a durable provider would. */
const createRecordingJobs = () => {
  const scheduled = new Map<string, ScheduleJobInput>();
  const jobs = {
    schedule: (input: ScheduleJobInput) => {
      scheduled.set(input.key, input);
      return Promise.resolve();
    },
    unschedule: (_name: string, key: string) => {
      scheduled.delete(key);
      return Promise.resolve();
    },
  } as unknown as JobQueueProvider;
  return { jobs, scheduled };
};

describe("function variables", () => {
  it("stores values encrypted, lists names only and passes values to runs", async () => {
    const fn = await newFunction("Variables reach runs");
    await setEnvVar({
      ...scopeOf(fn.id),
      actorId: organization.actorId,
      name: "API_KEY",
      value: SECRET,
    });

    const listed = await listEnvVars(scopeOf(fn.id));
    expect(listed.map((variable) => variable.name)).toEqual(["API_KEY"]);
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    const row = await prisma.codeFunctionEnvVar.findFirstOrThrow({
      where: { functionId: fn.id },
    });
    expect(row.valueEncrypted).not.toContain(SECRET);

    const { completion } = await startRun({
      ...scopeOf(fn.id),
      params: STARTER_PARAMS,
      trigger: "MANUAL",
    });
    await completion;
    expect(fake.state.requests.at(-1)?.env).toEqual({ API_KEY: SECRET });
    expect(await auditText(organization.organizationId)).not.toContain(SECRET);
  });

  it("scrubs values from stored output, errors and results, even when split", async () => {
    const fn = await newFunction("Variables are scrubbed");
    await setEnvVar({
      ...scopeOf(fn.id),
      actorId: organization.actorId,
      name: "TOKEN",
      value: SECRET,
    });
    fake.state.script = function* ({ request }) {
      const value = request.env.TOKEN ?? "";
      yield { type: "started" };
      yield {
        data: `token=${value.slice(0, 7)}`,
        stream: "stdout",
        type: "output",
      };
      yield { data: `${value.slice(7)}\n`, stream: "stdout", type: "output" };
      yield fakeExit({ result: { echoed: value, [value]: 1 } });
    };

    const { completion } = await startRun({
      ...scopeOf(fn.id),
      params: STARTER_PARAMS,
      trigger: "MANUAL",
    });
    const finished = await completion;

    expect(finished.output).toBe("token=[redacted]\n");
    expect(finished.result).toEqual({
      "[redacted]": 1,
      echoed: "[redacted]",
    });

    fake.state.script = function* ({ request }) {
      yield { type: "started" };
      yield fakeExit({
        error: `Error: bad key ${request.env.TOKEN}`,
        exitCode: 1,
        status: "FAILED",
      });
    };
    const failed = await (
      await startRun({
        ...scopeOf(fn.id),
        params: STARTER_PARAMS,
        trigger: "MANUAL",
      })
    ).completion;
    expect(failed.error).toBe("Error: bad key [redacted]");
  });

  it("refuses reserved or malformed names and deletes variables", async () => {
    const fn = await newFunction("Variable names");
    const set = (name: string) =>
      setEnvVar({
        ...scopeOf(fn.id),
        actorId: organization.actorId,
        name,
        value: "value",
      });
    for (const name of [
      "PATH",
      "NODE_OPTIONS",
      "LD_PRELOAD",
      "FN_X",
      "lower",
      "1A",
    ]) {
      expect((await failureOf(set(name))).failure).toBe("INVALID_ENV_VAR");
    }

    await set("GOOD_NAME");
    await deleteEnvVar({
      ...scopeOf(fn.id),
      actorId: organization.actorId,
      name: "GOOD_NAME",
    });
    expect(await listEnvVars(scopeOf(fn.id))).toEqual([]);
    const missing = await failureOf(
      deleteEnvVar({
        ...scopeOf(fn.id),
        actorId: organization.actorId,
        name: "GOOD_NAME",
      })
    );
    expect(missing.failure).toBe("ENV_VAR_NOT_FOUND");
    const audit = await auditText(organization.organizationId);
    expect(audit).toContain("function.env.set");
    expect(audit).toContain("function.env.deleted");
  });
});

describe("the HTTP trigger", () => {
  it("issues a token once, stores only its hash and accepts only the current one", async () => {
    const fn = await newFunction("HTTP tokens");
    const actor = { ...scopeOf(fn.id), actorId: organization.actorId };

    const enabled = await enableHttpTrigger(actor);
    expect(enabled.token).toMatch(TOKEN_FORMAT);
    expect(enabled.state).toEqual({
      enabled: true,
      tokenHint: enabled.token.slice(-4),
    });
    const stored = await prisma.codeFunction.findUniqueOrThrow({
      where: { id: fn.id },
    });
    expect(JSON.stringify(stored)).not.toContain(enabled.token);

    expect((await authenticateTrigger(fn.id, enabled.token))?.id).toBe(fn.id);
    expect(await authenticateTrigger(fn.id, `${enabled.token}x`)).toBeNull();
    expect(await authenticateTrigger(fn.id, null)).toBeNull();
    expect(await authenticateTrigger("unknown", enabled.token)).toBeNull();

    const rotated = await rotateHttpToken(actor);
    expect(await authenticateTrigger(fn.id, enabled.token)).toBeNull();
    expect((await authenticateTrigger(fn.id, rotated.token))?.id).toBe(fn.id);

    expect(await disableHttpTrigger(actor)).toEqual({
      enabled: false,
      tokenHint: null,
    });
    expect(await authenticateTrigger(fn.id, rotated.token)).toBeNull();

    const audit = await auditText(organization.organizationId);
    for (const action of [
      "function.http.enabled",
      "function.http.rotated",
      "function.http.disabled",
    ]) {
      expect(audit).toContain(action);
    }
    expect(audit).not.toContain(rotated.token);
  });

  it("waits for the result, answers pending when the run outlasts the wait, and reports a busy runner", async () => {
    const fn = await newFunction("HTTP invoke");
    const record = await prisma.codeFunction.findUniqueOrThrow({
      where: { id: fn.id },
    });

    const finished = await invokeFunction(record, STARTER_PARAMS);
    expect(finished.kind).toBe("finished");
    expect(finished.run).toMatchObject({
      result: { ok: true },
      status: "SUCCEEDED",
      trigger: "HTTP",
    });

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.state.script = async function* () {
      yield { type: "started" };
      await gate;
      yield fakeExit({ result: 2 });
    };
    const pending = await invokeFunction(record, STARTER_PARAMS, {
      waitMs: 100,
    });
    expect(pending.kind).toBe("pending");
    release();

    fake.reset();
    connectRunner(fake.url, fake.token);
    fake.state.refuseWith = 429;
    const busy = await invokeFunction(record, STARTER_PARAMS);
    expect(busy.kind).toBe("busy");
    expect(busy.run.status).toBe("FAILED");
  });
});

describe("schedules", () => {
  it("registers enabled schedules, validates params and keeps at most five", async () => {
    const fn = await functionWithParams("Schedules");
    const { jobs, scheduled } = createRecordingJobs();
    const actor = { ...scopeOf(fn.id), actorId: organization.actorId };

    const bad = await failureOf(
      createSchedule(
        {
          ...actor,
          cron: "* * * * *",
          enabled: true,
          params: { limit: "x" },
          timezone: "UTC",
        },
        { jobs }
      )
    );
    expect(bad.failure).toBe("PARAMS_INVALID");

    const schedule = await createSchedule(
      {
        ...actor,
        cron: "*/5 * * * *",
        enabled: true,
        params: { limit: 3 },
        timezone: "Asia/Ho_Chi_Minh",
      },
      { jobs }
    );
    expect(scheduled.get(schedule.id)).toMatchObject({
      cron: "*/5 * * * *",
      name: FUNCTION_SCHEDULE_JOB,
      payload: { scheduleId: schedule.id },
      timezone: "Asia/Ho_Chi_Minh",
    });

    await updateSchedule(
      {
        actorId: organization.actorId,
        enabled: false,
        organizationId: organization.organizationId,
        scheduleId: schedule.id,
      },
      { jobs }
    );
    expect(scheduled.has(schedule.id)).toBe(false);

    for (let index = 0; index < 4; index += 1) {
      await createSchedule(
        {
          ...actor,
          cron: "0 * * * *",
          enabled: false,
          params: {},
          timezone: "UTC",
        },
        { jobs }
      );
    }
    const sixth = await failureOf(
      createSchedule(
        {
          ...actor,
          cron: "0 * * * *",
          enabled: true,
          params: {},
          timezone: "UTC",
        },
        { jobs }
      )
    );
    expect(sixth.failure).toBe("INVALID_SCHEDULE");

    await deleteSchedule(
      {
        actorId: organization.actorId,
        organizationId: organization.organizationId,
        scheduleId: schedule.id,
      },
      { jobs }
    );
    expect(await listSchedules(scopeOf(fn.id))).toHaveLength(4);
    const audit = await auditText(organization.organizationId);
    for (const action of [
      "function.schedule.created",
      "function.schedule.updated",
      "function.schedule.deleted",
    ]) {
      expect(audit).toContain(action);
    }
  });

  it("starts a run when fired, and nothing once disabled", async () => {
    const fn = await functionWithParams("Schedule fires");
    const { jobs } = createRecordingJobs();
    const schedule = await createSchedule(
      {
        ...scopeOf(fn.id),
        actorId: organization.actorId,
        cron: "* * * * *",
        enabled: true,
        params: { limit: 3 },
        timezone: "UTC",
      },
      { jobs }
    );
    const job = createFunctionScheduleJob();
    const fire = () =>
      job.handler(
        { scheduleId: schedule.id },
        { runId: "test", signal: new AbortController().signal }
      );

    await fire();
    const run = await prisma.codeFunctionRun.findFirstOrThrow({
      where: { functionId: fn.id },
    });
    expect(run).toMatchObject({
      params: { limit: 3 },
      scheduleId: schedule.id,
      startedById: null,
      trigger: "SCHEDULE",
    });

    await updateSchedule(
      {
        actorId: organization.actorId,
        enabled: false,
        organizationId: organization.organizationId,
        scheduleId: schedule.id,
      },
      { jobs }
    );
    await fire();
    expect(
      await prisma.codeFunctionRun.count({ where: { functionId: fn.id } })
    ).toBe(1);
  });

  it("refuses schedules, and saves nothing, when the job queue has none", async () => {
    const fn = await functionWithParams("No scheduler");
    const failure = await failureOf(
      createSchedule(
        {
          ...scopeOf(fn.id),
          actorId: organization.actorId,
          cron: "* * * * *",
          enabled: true,
          params: {},
          timezone: "UTC",
        },
        { jobs: createLocalJobProvider() }
      )
    );
    expect(failure.failure).toBe("SCHEDULES_UNAVAILABLE");
    expect(await listSchedules(scopeOf(fn.id))).toEqual([]);
  });

  it("fires through the durable job queue at the minute", async () => {
    const fn = await functionWithParams("Durable schedule");
    const schema = `pgboss_functions_${fn.id.slice(-10)}`;
    const jobs = createPgBossJobProvider({
      connectionString: process.env.DATABASE_URL as string,
      pollingIntervalSeconds: 0.5,
      schema,
    });
    jobs.register(createFunctionScheduleJob());
    await jobs.start();
    try {
      await createSchedule(
        {
          ...scopeOf(fn.id),
          actorId: organization.actorId,
          cron: "* * * * *",
          enabled: true,
          params: {},
          timezone: "UTC",
        },
        { jobs }
      );
      const deadline = Date.now() + 130_000;
      const count = () =>
        prisma.codeFunctionRun.count({
          where: { functionId: fn.id, trigger: "SCHEDULE" },
        });
      while ((await count()) === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(await count()).toBeGreaterThan(0);
    } finally {
      await jobs.stop();
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`
      );
    }
  }, 180_000);
});
