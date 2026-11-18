import { type Prisma, prisma } from "@repo/database";
import { recordFunctionAudit } from "../audit";
import {
  ACTIVE_RUN_STATUSES,
  describeParamErrors,
  isParamsSchema,
  validateParams,
} from "../definition";
import { FunctionsError, runNotFound } from "../errors";
import { functionsDisabled, functionsEnabled } from "../keys";
import { reinstallForRun } from "./deps";
import {
  type CodeFunctionRunRecord,
  executeRun,
  stopActiveRun,
} from "./execute";
import { type FunctionScope, getFunction } from "./functions";

export type { CodeFunctionRunRecord } from "./execute";
export type CodeFunctionRunSummary = Omit<CodeFunctionRunRecord, "output">;

export type RunTrigger = CodeFunctionRunRecord["trigger"];

export interface RunScope {
  organizationId: string;
  runId: string;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Unscoped lookup, for deciding which organization a run belongs to. */
export const findRunById = (
  runId: string
): Promise<CodeFunctionRunSummary | null> =>
  prisma.codeFunctionRun.findUnique({
    omit: { output: true },
    where: { id: runId },
  });

export const getRun = async ({
  organizationId,
  runId,
}: RunScope): Promise<CodeFunctionRunRecord> => {
  const run = await prisma.codeFunctionRun.findFirst({
    where: { id: runId, organizationId },
  });
  if (!run) {
    throw runNotFound();
  }
  return run;
};

/** A function's runs, newest first, without their output. */
export const listRuns = async (
  scope: FunctionScope,
  page: { cursor?: string | undefined; limit?: number | undefined } = {}
): Promise<{ nextCursor: string | null; runs: CodeFunctionRunSummary[] }> => {
  const limit = Math.min(page.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const runs = await prisma.codeFunctionRun.findMany({
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    omit: { output: true },
    orderBy: { number: "desc" },
    take: limit + 1,
    where: {
      functionId: scope.functionId,
      organizationId: scope.organizationId,
    },
  });
  const more = runs.length > limit;
  const shown = more ? runs.slice(0, limit) : runs;
  return {
    nextCursor: more ? (shown.at(-1)?.id ?? null) : null,
    runs: shown,
  };
};

/**
 * Starts a run of a function's saved source. Execution continues in the
 * background; `completion` settles with the finished run for callers that
 * wait for it.
 */
export const startRun = async (
  input: FunctionScope & {
    actorId?: string | null | undefined;
    params: Record<string, unknown>;
    trigger: RunTrigger;
  }
): Promise<{
  completion: Promise<CodeFunctionRunRecord>;
  run: CodeFunctionRunRecord;
}> => {
  if (!functionsEnabled()) {
    throw functionsDisabled();
  }
  const fn = await getFunction(input);
  if (fn.depsStatus === "BUILDING") {
    throw new FunctionsError(
      "DEPS_NOT_READY",
      "The packages are still installing. Run it again when they are ready."
    );
  }
  if (fn.depsStatus === "FAILED") {
    throw new FunctionsError(
      "DEPS_NOT_READY",
      "The packages failed to install. Fix the manifest or install them again."
    );
  }
  const schema = isParamsSchema(fn.paramsSchema) ? fn.paramsSchema : null;
  const validation = validateParams(schema, input.params);
  if (!validation.ok) {
    throw new FunctionsError(
      "PARAMS_INVALID",
      `Check the parameters: ${describeParamErrors(validation.errors)}.`
    );
  }

  const run = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fn.id}, 0))::text AS locked`;
    const last = await db.codeFunctionRun.aggregate({
      _max: { number: true },
      where: { functionId: fn.id },
    });
    const created = await db.codeFunctionRun.create({
      data: {
        functionId: fn.id,
        number: (last._max.number ?? 0) + 1,
        organizationId: fn.organizationId,
        params: validation.params as Prisma.InputJsonObject,
        sourceHash: fn.sourceHash,
        startedById: input.actorId ?? null,
        trigger: input.trigger,
      },
    });
    if (input.actorId) {
      await recordFunctionAudit(db, {
        action: "function.run.started",
        actorId: input.actorId,
        metadata: {
          name: fn.name,
          runNumber: created.number,
          trigger: input.trigger,
        },
        organizationId: fn.organizationId,
        targetId: created.id,
        targetType: "CodeFunctionRun",
      });
    }
    return created;
  });

  const completion = executeRun(
    {
      env: {},
      files: fn.files.map(({ content, path }) => ({ content, path })),
      memoryMb: fn.memoryMb,
      params: validation.params,
      runId: run.id,
      runtime: fn.runtime,
      timeoutSeconds: fn.timeoutSeconds,
      ...(schema ? { paramOrder: schema["x-order"] } : {}),
      ...(fn.depsKey ? { depsKey: fn.depsKey } : {}),
    },
    fn.depsKey ? { reinstallDeps: () => reinstallForRun(fn) } : {}
  );
  return { completion, run };
};

/** Stops a queued or running run. */
export const cancelRun = async (
  input: RunScope & { actorId: string }
): Promise<CodeFunctionRunSummary> => {
  const run = await getRun(input);
  const marked = await prisma.codeFunctionRun.updateMany({
    data: { cancelRequestedAt: new Date() },
    where: { id: run.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
  });
  if (marked.count === 0) {
    throw new FunctionsError(
      "RUN_NOT_ACTIVE",
      "This run has already finished."
    );
  }
  await recordFunctionAudit(prisma, {
    action: "function.run.canceled",
    actorId: input.actorId,
    metadata: { runNumber: run.number },
    organizationId: run.organizationId,
    targetId: run.id,
    targetType: "CodeFunctionRun",
  });
  if (!stopActiveRun(run.id)) {
    // No process is executing it, so nothing else will finish the row.
    await prisma.codeFunctionRun.updateMany({
      data: { finishedAt: new Date(), status: "CANCELED" },
      where: { id: run.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
    });
  }
  const { output: _output, ...summary } = await getRun(input);
  return summary;
};

/**
 * Marks runs that a stopped server left queued or running as failed. Call
 * once at startup, before new runs begin.
 */
export const failInterruptedRuns = async (
  before: Date = new Date()
): Promise<number> => {
  const result = await prisma.codeFunctionRun.updateMany({
    data: {
      error: "The server restarted while this run was in progress.",
      finishedAt: new Date(),
      status: "FAILED",
    },
    where: {
      createdAt: { lt: before },
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
  });
  return result.count;
};
