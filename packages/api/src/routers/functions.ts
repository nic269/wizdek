import { prisma } from "@repo/database";
import {
  addGrant,
  type CodeFunctionRecord,
  type CodeFunctionRunSummary,
  type CodeFunctionScheduleRecord,
  type CodeFunctionWithFiles,
  cancelRun,
  createFunction,
  createSchedule,
  deleteEnvVar,
  deleteFunction,
  deleteSchedule,
  disableHttpTrigger,
  enableHttpTrigger,
  functionsEnabled,
  getFunction,
  getRun,
  getRunner,
  httpTriggerStateOf,
  listEnvVars,
  listFunctions,
  listGrants,
  listRuns,
  listSchedules,
  reinstallDeps,
  removeGrant,
  rotateHttpToken,
  saveFiles,
  setEnvVar,
  startRun,
  unscheduleFunction,
  updateFunction,
  updateSchedule,
} from "@repo/functions";
import {
  FUNCTION_RUNTIMES,
  isParamsSchema,
  RUNTIME_LABELS,
} from "@repo/functions/definition";
import { getJobProvider } from "../jobs";
import {
  requireFunctionGrantPermission,
  requireFunctionPermission,
  requireFunctionRunPermission,
  requireFunctionSchedulePermission,
  requireOrganizationAccess,
  requireOrganizationPermission,
} from "./authz";
import { withFunctionErrors } from "./function-errors";
import { os } from "./implementer";

const toPublicSummary = (fn: CodeFunctionRecord) => ({
  createdAt: fn.createdAt,
  depsBuiltAt: fn.depsBuiltAt,
  depsError: fn.depsError,
  depsStatus: fn.depsStatus,
  description: fn.description,
  id: fn.id,
  memoryMb: fn.memoryMb,
  name: fn.name,
  organizationId: fn.organizationId,
  paramsError: fn.paramsError,
  paramsStale: fn.paramsStale,
  runtime: fn.runtime,
  timeoutSeconds: fn.timeoutSeconds,
  updatedAt: fn.updatedAt,
});

const toPublicFunction = (fn: CodeFunctionWithFiles) => ({
  ...toPublicSummary(fn),
  depsLog: fn.depsLog,
  files: fn.files.map(({ content, path }) => ({ content, path })),
  httpTrigger: httpTriggerStateOf(fn),
  paramsSchema: isParamsSchema(fn.paramsSchema) ? fn.paramsSchema : null,
  sourceHash: fn.sourceHash,
});

/** Display names of the people who started some runs. */
const starterNamesOf = async (
  runs: readonly Pick<CodeFunctionRunSummary, "startedById">[]
): Promise<Map<string, string>> => {
  const ids = [
    ...new Set(
      runs.flatMap((run) => (run.startedById ? [run.startedById] : []))
    ),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    where: { id: { in: ids } },
  });
  return new Map(users.map((user) => [user.id, user.name]));
};

const toPublicRunSummary = (
  run: CodeFunctionRunSummary,
  names: Map<string, string>
) => ({
  cancelRequestedAt: run.cancelRequestedAt,
  createdAt: run.createdAt,
  dbCallCount: run.dbCallCount,
  durationMs: run.durationMs,
  error: run.error,
  exitCode: run.exitCode,
  finishedAt: run.finishedAt,
  functionId: run.functionId,
  id: run.id,
  number: run.number,
  organizationId: run.organizationId,
  outputTruncated: run.outputTruncated,
  params: (run.params ?? {}) as Record<string, unknown>,
  result: run.result,
  scheduleId: run.scheduleId,
  shopifyCallCount: run.shopifyCallCount,
  sourceHash: run.sourceHash,
  startedAt: run.startedAt,
  startedByName: run.startedById ? (names.get(run.startedById) ?? null) : null,
  status: run.status,
  trigger: run.trigger,
});

const toPublicSchedule = (schedule: CodeFunctionScheduleRecord) => ({
  createdAt: schedule.createdAt,
  cron: schedule.cron,
  enabled: schedule.enabled,
  functionId: schedule.functionId,
  id: schedule.id,
  params: (schedule.params ?? {}) as Record<string, unknown>,
  timezone: schedule.timezone,
  updatedAt: schedule.updatedAt,
});

const scopeOf = (fn: CodeFunctionRecord) => ({
  functionId: fn.id,
  organizationId: fn.organizationId,
});

const runScopeOf = (run: CodeFunctionRunSummary) => ({
  organizationId: run.organizationId,
  runId: run.id,
});

/** Asks the runner whether it is up; never throws. */
const runnerStatus = async () => {
  const runtimes = FUNCTION_RUNTIMES.map((id) => ({
    id,
    label: RUNTIME_LABELS[id],
    ready: false,
  }));
  if (!functionsEnabled()) {
    return { enabled: false, reachable: false, runtimes };
  }
  try {
    const health = await getRunner().health();
    const ready = new Set(
      health.runtimes.filter((runtime) => runtime.ready).map(({ id }) => id)
    );
    return {
      enabled: true,
      reachable: true,
      runtimes: runtimes.map((runtime) => ({
        ...runtime,
        ready: ready.has(runtime.id),
      })),
    };
  } catch {
    return { enabled: true, reachable: false, runtimes };
  }
};

export const functionsRouter = {
  addGrant: os.functions.addGrant.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "manage"
    );
    // Granting hands the function what the person may do with the resource,
    // so the person must hold it: reading a database, or mutating a store.
    const needed: [module: string, action: string][] =
      input.kind === "DATABASE"
        ? [["databases", "read"]]
        : [
            ["stores", "read"],
            ["graphql", "mutate"],
          ];
    for (const [module, action] of needed) {
      await requireOrganizationPermission(
        user.id,
        fn.organizationId,
        module,
        action,
        input.kind === "DATABASE"
          ? "You need permission to view database connections to grant one."
          : "You need permission to view stores and run GraphQL mutations to grant a store."
      );
    }
    const grant = await withFunctionErrors(() =>
      addGrant({
        ...scopeOf(fn),
        actorId: user.id,
        alias: input.alias,
        kind: input.kind,
        resourceId: input.resourceId,
      })
    );
    return { data: grant };
  }),
  create: os.functions.create.handler(async ({ context, input }) => {
    const user = await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "functions",
      "manage"
    );
    const created = await withFunctionErrors(() =>
      createFunction({
        actorId: user.id,
        description: input.description,
        name: input.name,
        organizationId: input.organizationId,
        runtime: input.runtime,
      })
    );
    return { data: toPublicFunction(created) };
  }),
  delete: os.functions.delete.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "manage"
    );
    await withFunctionErrors(async () => {
      await unscheduleFunction(fn.id, { jobs: getJobProvider() });
      await deleteFunction({ ...scopeOf(fn), actorId: user.id });
    });
    return { data: { id: fn.id } };
  }),
  deleteEnvVar: os.functions.deleteEnvVar.handler(
    async ({ context, input }) => {
      const { fn, user } = await requireFunctionPermission(
        context.headers,
        input.functionId,
        "manage"
      );
      await withFunctionErrors(() =>
        deleteEnvVar({ ...scopeOf(fn), actorId: user.id, name: input.name })
      );
      return { data: { name: input.name } };
    }
  ),
  disableHttpTrigger: os.functions.disableHttpTrigger.handler(
    async ({ context, input }) => {
      const { fn, user } = await requireFunctionPermission(
        context.headers,
        input.functionId,
        "manage"
      );
      const state = await withFunctionErrors(() =>
        disableHttpTrigger({ ...scopeOf(fn), actorId: user.id })
      );
      return { data: state };
    }
  ),
  enableHttpTrigger: os.functions.enableHttpTrigger.handler(
    async ({ context, input }) => {
      const { fn, user } = await requireFunctionPermission(
        context.headers,
        input.functionId,
        "manage"
      );
      const { state, token } = await withFunctionErrors(() =>
        enableHttpTrigger({ ...scopeOf(fn), actorId: user.id })
      );
      return { data: { httpTrigger: state, token } };
    }
  ),
  get: os.functions.get.handler(async ({ context, input }) => {
    const { fn } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "read"
    );
    const found = await withFunctionErrors(() => getFunction(scopeOf(fn)));
    return { data: toPublicFunction(found) };
  }),
  list: os.functions.list.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "functions",
      "read"
    );
    const functions = await listFunctions(input.organizationId);
    return {
      data: functions.map((fn) => ({
        ...toPublicSummary(fn),
        lastRun: fn.lastRun,
      })),
    };
  }),
  listEnvVars: os.functions.listEnvVars.handler(async ({ context, input }) => {
    const { fn } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "read"
    );
    return {
      data: await withFunctionErrors(() => listEnvVars(scopeOf(fn))),
    };
  }),
  listGrants: os.functions.listGrants.handler(async ({ context, input }) => {
    const { fn } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "read"
    );
    return {
      data: await withFunctionErrors(() => listGrants(scopeOf(fn))),
    };
  }),
  reinstallDeps: os.functions.reinstallDeps.handler(
    async ({ context, input }) => {
      const { fn, user } = await requireFunctionPermission(
        context.headers,
        input.functionId,
        "manage"
      );
      const updated = await withFunctionErrors(() =>
        reinstallDeps({ ...scopeOf(fn), actorId: user.id })
      );
      return { data: toPublicFunction(updated) };
    }
  ),
  removeGrant: os.functions.removeGrant.handler(async ({ context, input }) => {
    const { grant, user } = await requireFunctionGrantPermission(
      context.headers,
      input.grantId,
      "manage"
    );
    await withFunctionErrors(() =>
      removeGrant({
        actorId: user.id,
        grantId: grant.id,
        organizationId: grant.function.organizationId,
      })
    );
    return { data: { id: grant.id } };
  }),
  rotateHttpToken: os.functions.rotateHttpToken.handler(
    async ({ context, input }) => {
      const { fn, user } = await requireFunctionPermission(
        context.headers,
        input.functionId,
        "manage"
      );
      const { state, token } = await withFunctionErrors(() =>
        rotateHttpToken({ ...scopeOf(fn), actorId: user.id })
      );
      return { data: { httpTrigger: state, token } };
    }
  ),
  saveFiles: os.functions.saveFiles.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "manage"
    );
    const saved = await withFunctionErrors(() =>
      saveFiles({
        ...scopeOf(fn),
        actorId: user.id,
        expectedHash: input.baseHash,
        files: input.files,
      })
    );
    return { data: toPublicFunction(saved) };
  }),
  setEnvVar: os.functions.setEnvVar.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "manage"
    );
    const saved = await withFunctionErrors(() =>
      setEnvVar({
        ...scopeOf(fn),
        actorId: user.id,
        name: input.name,
        value: input.value,
      })
    );
    return { data: saved };
  }),
  status: os.functions.status.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "functions",
      "read"
    );
    return { data: await runnerStatus() };
  }),
  update: os.functions.update.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "manage"
    );
    const updated = await withFunctionErrors(async () => {
      await updateFunction({
        ...scopeOf(fn),
        actorId: user.id,
        description: input.description,
        memoryMb: input.memoryMb,
        name: input.name,
        timeoutSeconds: input.timeoutSeconds,
      });
      return getFunction(scopeOf(fn));
    });
    return { data: toPublicFunction(updated) };
  }),
};

export const functionRunsRouter = {
  cancel: os.functionRuns.cancel.handler(async ({ context, input }) => {
    const { run, user } = await requireFunctionRunPermission(
      context.headers,
      input.runId,
      "run"
    );
    const canceled = await withFunctionErrors(() =>
      cancelRun({ ...runScopeOf(run), actorId: user.id })
    );
    return {
      data: toPublicRunSummary(canceled, await starterNamesOf([canceled])),
    };
  }),
  get: os.functionRuns.get.handler(async ({ context, input }) => {
    const { run } = await requireFunctionRunPermission(
      context.headers,
      input.runId,
      "read"
    );
    const { output, ...summary } = await withFunctionErrors(() =>
      getRun(runScopeOf(run))
    );
    return {
      data: {
        ...toPublicRunSummary(summary, await starterNamesOf([summary])),
        output: output.slice(input.outputOffset),
        outputLength: output.length,
      },
    };
  }),
  list: os.functionRuns.list.handler(async ({ context, input }) => {
    const { fn } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "read"
    );
    const page = await listRuns(scopeOf(fn), {
      cursor: input.cursor,
      limit: input.limit,
    });
    const names = await starterNamesOf(page.runs);
    return {
      data: page.runs.map((run) => toPublicRunSummary(run, names)),
      pageInfo: { nextCursor: page.nextCursor },
    };
  }),
  start: os.functionRuns.start.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "run"
    );
    const { completion, run } = await withFunctionErrors(() =>
      startRun({
        ...scopeOf(fn),
        actorId: user.id,
        params: input.params,
        trigger: "MANUAL",
      })
    );
    // The run continues after the response; its row records the outcome.
    completion.catch((error: unknown) => {
      console.error("functions.run_failed", error);
    });
    return { data: toPublicRunSummary(run, await starterNamesOf([run])) };
  }),
};

export const functionSchedulesRouter = {
  create: os.functionSchedules.create.handler(async ({ context, input }) => {
    const { fn, user } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "manage"
    );
    const created = await withFunctionErrors(() =>
      createSchedule(
        {
          ...scopeOf(fn),
          actorId: user.id,
          cron: input.cron,
          enabled: input.enabled,
          params: input.params,
          timezone: input.timezone,
        },
        { jobs: getJobProvider() }
      )
    );
    return { data: toPublicSchedule(created) };
  }),
  delete: os.functionSchedules.delete.handler(async ({ context, input }) => {
    const { schedule, user } = await requireFunctionSchedulePermission(
      context.headers,
      input.scheduleId,
      "manage"
    );
    await withFunctionErrors(() =>
      deleteSchedule(
        {
          actorId: user.id,
          organizationId: schedule.function.organizationId,
          scheduleId: schedule.id,
        },
        { jobs: getJobProvider() }
      )
    );
    return { data: { id: schedule.id } };
  }),
  list: os.functionSchedules.list.handler(async ({ context, input }) => {
    const { fn } = await requireFunctionPermission(
      context.headers,
      input.functionId,
      "read"
    );
    const schedules = await withFunctionErrors(() =>
      listSchedules(scopeOf(fn))
    );
    return { data: schedules.map(toPublicSchedule) };
  }),
  update: os.functionSchedules.update.handler(async ({ context, input }) => {
    const { schedule, user } = await requireFunctionSchedulePermission(
      context.headers,
      input.scheduleId,
      "manage"
    );
    const updated = await withFunctionErrors(() =>
      updateSchedule(
        {
          actorId: user.id,
          cron: input.cron,
          enabled: input.enabled,
          organizationId: schedule.function.organizationId,
          params: input.params,
          scheduleId: schedule.id,
          timezone: input.timezone,
        },
        { jobs: getJobProvider() }
      )
    );
    return { data: toPublicSchedule(updated) };
  }),
};
