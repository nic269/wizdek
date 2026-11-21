import { type Prisma, prisma } from "@repo/database";
import type { JobDefinition, JobQueueProvider } from "@repo/jobs";
import { recordFunctionAudit } from "../audit";
import {
  describeParamErrors,
  isParamsSchema,
  SCHEDULE_LIMITS,
  validateParams,
} from "../definition";
import { FunctionsError, scheduleNotFound } from "../errors";
import {
  type CodeFunctionRecord,
  type FunctionScope,
  getFunction,
} from "./functions";
import { startRun } from "./runs";

export const FUNCTION_SCHEDULE_JOB = "function-schedule";

export type CodeFunctionScheduleRecord =
  Prisma.CodeFunctionScheduleGetPayload<object>;

export interface ScheduleScope {
  organizationId: string;
  scheduleId: string;
}

export interface ScheduleFields {
  cron: string;
  enabled: boolean;
  params: Record<string, unknown>;
  timezone: string;
}

interface Dependencies {
  jobs: JobQueueProvider;
}

/** Unscoped lookup, for deciding which organization a schedule belongs to. */
export const findScheduleById = (
  scheduleId: string
): Promise<
  (CodeFunctionScheduleRecord & { function: CodeFunctionRecord }) | null
> =>
  prisma.codeFunctionSchedule.findUnique({
    include: { function: true },
    where: { id: scheduleId },
  });

const getSchedule = async ({ organizationId, scheduleId }: ScheduleScope) => {
  const schedule = await findScheduleById(scheduleId);
  if (schedule?.function.organizationId !== organizationId) {
    throw scheduleNotFound();
  }
  return schedule;
};

export const listSchedules = async (
  scope: FunctionScope
): Promise<CodeFunctionScheduleRecord[]> => {
  const fn = await getFunction(scope);
  return prisma.codeFunctionSchedule.findMany({
    orderBy: { createdAt: "asc" },
    where: { functionId: fn.id },
  });
};

/** The params as the function's form would accept them now. */
const checkedParams = (
  fn: CodeFunctionRecord,
  params: Record<string, unknown>
): Prisma.InputJsonObject => {
  const schema = isParamsSchema(fn.paramsSchema) ? fn.paramsSchema : null;
  const validation = validateParams(schema, params);
  if (!validation.ok) {
    throw new FunctionsError(
      "PARAMS_INVALID",
      `Check the parameters: ${describeParamErrors(validation.errors)}.`
    );
  }
  return validation.params as Prisma.InputJsonObject;
};

/**
 * Talks to the job provider. Its failure, e.g. the in-memory provider that
 * has no schedules, becomes an error the caller can show; callers do this
 * inside their transaction, so the row is not saved either.
 */
const withScheduler = async (work: () => Promise<void>): Promise<void> => {
  try {
    await work();
  } catch (error) {
    console.error("functions.scheduler_failed", error);
    throw new FunctionsError(
      "SCHEDULES_UNAVAILABLE",
      "Schedules are not available on this server. They need the durable job queue."
    );
  }
};

/** Registers or removes a schedule with the job provider; safe to repeat. */
const syncSchedule = (
  schedule: CodeFunctionScheduleRecord,
  { jobs }: Dependencies
): Promise<void> =>
  withScheduler(async () => {
    if (schedule.enabled) {
      await jobs.schedule({
        cron: schedule.cron,
        key: schedule.id,
        name: FUNCTION_SCHEDULE_JOB,
        payload: { scheduleId: schedule.id },
        timezone: schedule.timezone,
      });
    } else {
      await jobs.unschedule(FUNCTION_SCHEDULE_JOB, schedule.id);
    }
  });

const auditMetadata = (
  fn: CodeFunctionRecord,
  schedule: CodeFunctionScheduleRecord
): Prisma.InputJsonObject => ({
  cron: schedule.cron,
  enabled: schedule.enabled,
  functionId: fn.id,
  name: fn.name,
  timezone: schedule.timezone,
});

export const createSchedule = async (
  input: FunctionScope & ScheduleFields & { actorId: string },
  dependencies: Dependencies
): Promise<CodeFunctionScheduleRecord> => {
  const fn = await getFunction(input);
  const params = checkedParams(fn, input.params);
  const schedule = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT 1 FROM "code_function" WHERE "id" = ${fn.id} FOR UPDATE`;
    const count = await db.codeFunctionSchedule.count({
      where: { functionId: fn.id },
    });
    if (count >= SCHEDULE_LIMITS.perFunction) {
      throw new FunctionsError(
        "INVALID_SCHEDULE",
        `A function can have at most ${SCHEDULE_LIMITS.perFunction} schedules.`
      );
    }
    const created = await db.codeFunctionSchedule.create({
      data: {
        createdById: input.actorId,
        cron: input.cron.trim(),
        enabled: input.enabled,
        functionId: fn.id,
        params,
        timezone: input.timezone,
      },
    });
    await recordFunctionAudit(db, {
      action: "function.schedule.created",
      actorId: input.actorId,
      metadata: auditMetadata(fn, created),
      organizationId: fn.organizationId,
      targetId: created.id,
      targetType: "CodeFunctionSchedule",
    });
    await syncSchedule(created, dependencies);
    return created;
  });
  return schedule;
};

export const updateSchedule = async (
  input: ScheduleScope & {
    [Field in keyof ScheduleFields]?: ScheduleFields[Field] | undefined;
  } & { actorId: string },
  dependencies: Dependencies
): Promise<CodeFunctionScheduleRecord> => {
  const { function: fn, ...current } = await getSchedule(input);
  const params = input.params ? checkedParams(fn, input.params) : undefined;
  const schedule = await prisma.$transaction(async (db) => {
    const updated = await db.codeFunctionSchedule.update({
      data: {
        ...(input.cron === undefined ? {} : { cron: input.cron.trim() }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(params === undefined ? {} : { params }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      },
      where: { id: current.id },
    });
    await recordFunctionAudit(db, {
      action: "function.schedule.updated",
      actorId: input.actorId,
      metadata: auditMetadata(fn, updated),
      organizationId: fn.organizationId,
      targetId: updated.id,
      targetType: "CodeFunctionSchedule",
    });
    await syncSchedule(updated, dependencies);
    return updated;
  });
  return schedule;
};

export const deleteSchedule = async (
  input: ScheduleScope & { actorId: string },
  { jobs }: Dependencies
): Promise<void> => {
  const { function: fn, ...current } = await getSchedule(input);
  await prisma.$transaction(async (db) => {
    await db.codeFunctionSchedule.delete({ where: { id: current.id } });
    await recordFunctionAudit(db, {
      action: "function.schedule.deleted",
      actorId: input.actorId,
      metadata: auditMetadata(fn, current),
      organizationId: fn.organizationId,
      targetId: current.id,
      targetType: "CodeFunctionSchedule",
    });
    await withScheduler(() =>
      jobs.unschedule(FUNCTION_SCHEDULE_JOB, current.id)
    );
  });
};

/** Removes a function's schedules from the job provider before it is deleted. */
export const unscheduleFunction = async (
  functionId: string,
  { jobs }: Dependencies
): Promise<void> => {
  const schedules = await prisma.codeFunctionSchedule.findMany({
    select: { id: true },
    where: { functionId },
  });
  await withScheduler(async () => {
    await Promise.all(
      schedules.map(({ id }) => jobs.unschedule(FUNCTION_SCHEDULE_JOB, id))
    );
  });
};

interface FunctionScheduleJobPayload extends Record<string, unknown> {
  scheduleId: string;
}

/**
 * Fired by a schedule. Starts one run and returns without waiting for it. A
 * schedule that was disabled or deleted in the meantime does nothing, and a
 * run that cannot start is logged rather than retried.
 */
export const createFunctionScheduleJob =
  (): JobDefinition<FunctionScheduleJobPayload> => ({
    handler: async ({ scheduleId }) => {
      const schedule = await findScheduleById(scheduleId);
      if (!schedule?.enabled) {
        return;
      }
      try {
        const { completion } = await startRun({
          functionId: schedule.functionId,
          organizationId: schedule.function.organizationId,
          params: (schedule.params ?? {}) as Record<string, unknown>,
          scheduleId: schedule.id,
          trigger: "SCHEDULE",
        });
        completion.catch((error: unknown) => {
          console.error("functions.run_failed", error);
        });
      } catch (error) {
        if (!(error instanceof FunctionsError)) {
          throw error;
        }
        console.error("functions.schedule_skipped", {
          failure: error.failure,
          scheduleId,
        });
      }
    },
    name: FUNCTION_SCHEDULE_JOB,
  });
