import { prisma } from "@repo/database";
import {
  type CodeFunctionRecord,
  type CodeFunctionRunSummary,
  type CodeFunctionWithFiles,
  cancelRun,
  createFunction,
  deleteFunction,
  functionsEnabled,
  getFunction,
  getRun,
  getRunner,
  listFunctions,
  listRuns,
  reinstallDeps,
  saveFiles,
  startRun,
  updateFunction,
} from "@repo/functions";
import {
  FUNCTION_RUNTIMES,
  isParamsSchema,
  RUNTIME_LABELS,
} from "@repo/functions/definition";
import {
  requireFunctionPermission,
  requireFunctionRunPermission,
  requireOrganizationAccess,
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
  sourceHash: run.sourceHash,
  startedAt: run.startedAt,
  startedByName: run.startedById ? (names.get(run.startedById) ?? null) : null,
  status: run.status,
  trigger: run.trigger,
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
    await withFunctionErrors(() =>
      deleteFunction({ ...scopeOf(fn), actorId: user.id })
    );
    return { data: { id: fn.id } };
  }),
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
