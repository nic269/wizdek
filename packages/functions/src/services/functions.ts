import { Prisma, prisma } from "@repo/database";
import { recordFunctionAudit } from "../audit";
import {
  ENTRY_FILES,
  entryFileOf,
  FUNCTION_LIMITS,
  type FunctionFileInput,
  type FunctionRuntime,
  filesProblem,
  STARTER_FILES,
} from "../definition";
import { FunctionsError, functionNotFound } from "../errors";
import { functionsEnabled } from "../keys";
import { getRunner } from "../runner/client";
import { sourceHashOf } from "../source";

export type CodeFunctionRecord = Prisma.CodeFunctionGetPayload<object>;
export type CodeFunctionWithFiles = Prisma.CodeFunctionGetPayload<{
  include: { files: true };
}>;

export interface FunctionScope {
  functionId: string;
  organizationId: string;
}

const FILE_ORDER = { path: "asc" } as const;

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

const nameTaken = (name: string) =>
  new FunctionsError(
    "NAME_TAKEN",
    `A function named "${name}" already exists.`
  );

const normalizeName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new FunctionsError("INVALID_NAME", "Give the function a name.");
  }
  if (trimmed.length > FUNCTION_LIMITS.nameLength) {
    throw new FunctionsError(
      "INVALID_NAME",
      `Keep the name under ${FUNCTION_LIMITS.nameLength} characters.`
    );
  }
  return trimmed;
};

const normalizeDescription = (
  description: string | null | undefined
): string | null | undefined => {
  if (description === undefined || description === null) {
    return description;
  }
  const trimmed = description.trim();
  if (trimmed.length > FUNCTION_LIMITS.descriptionLength) {
    throw new FunctionsError(
      "INVALID_SETTINGS",
      `Keep the description under ${FUNCTION_LIMITS.descriptionLength} characters.`
    );
  }
  return trimmed || null;
};

const checkLimits = (settings: {
  memoryMb?: number | undefined;
  timeoutSeconds?: number | undefined;
}) => {
  const { memoryMb, timeoutSeconds } = settings;
  if (
    timeoutSeconds !== undefined &&
    !(
      Number.isInteger(timeoutSeconds) &&
      timeoutSeconds >= 1 &&
      timeoutSeconds <= FUNCTION_LIMITS.timeoutSeconds
    )
  ) {
    throw new FunctionsError(
      "INVALID_SETTINGS",
      `The timeout must be between 1 and ${FUNCTION_LIMITS.timeoutSeconds} seconds.`
    );
  }
  if (
    memoryMb !== undefined &&
    !(FUNCTION_LIMITS.memoryMb as readonly number[]).includes(memoryMb)
  ) {
    throw new FunctionsError(
      "INVALID_SETTINGS",
      `Memory must be one of ${FUNCTION_LIMITS.memoryMb.join(", ")} MB.`
    );
  }
};

const checkFiles = (files: readonly FunctionFileInput[]) => {
  const problem = filesProblem(files);
  if (problem) {
    throw new FunctionsError("INVALID_FILES", problem);
  }
};

interface ParamsColumns {
  paramsError?: string | null;
  paramsSchema?: Prisma.InputJsonObject | typeof Prisma.DbNull;
  paramsStale: boolean;
}

/**
 * Reads the form schema from the entry file. When the runner cannot be
 * asked, the previous schema stays and is flagged stale.
 */
const paramsColumnsFor = async (
  runtime: FunctionRuntime,
  files: readonly FunctionFileInput[]
): Promise<ParamsColumns> => {
  const entry = entryFileOf(
    runtime,
    files.map((file) => file.path)
  );
  const source = files.find((file) => file.path === entry)?.content;
  if (source === undefined) {
    return {
      paramsError: `Add ${ENTRY_FILES[runtime].join(" or ")} with a function named main.`,
      paramsSchema: Prisma.DbNull,
      paramsStale: false,
    };
  }
  if (!functionsEnabled()) {
    return { paramsStale: true };
  }
  try {
    const result = await getRunner().inspect(runtime, source);
    return "schema" in result
      ? {
          paramsError: null,
          paramsSchema: result.schema as unknown as Prisma.InputJsonObject,
          paramsStale: false,
        }
      : {
          paramsError: result.error,
          paramsSchema: Prisma.DbNull,
          paramsStale: false,
        };
  } catch {
    return { paramsStale: true };
  }
};

export type CodeFunctionListItem = CodeFunctionRecord & {
  lastRun: { createdAt: Date; status: CodeFunctionRunStatus } | null;
};

type CodeFunctionRunStatus = Prisma.CodeFunctionRunGetPayload<object>["status"];

/** An organization's functions by name, each with its newest run. */
export const listFunctions = async (
  organizationId: string
): Promise<CodeFunctionListItem[]> => {
  const functions = await prisma.codeFunction.findMany({
    include: {
      runs: {
        orderBy: { number: "desc" },
        select: { createdAt: true, status: true },
        take: 1,
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    where: { organizationId },
  });
  return functions.map(({ runs, ...fn }) => ({
    ...fn,
    lastRun: runs[0] ?? null,
  }));
};

/** Unscoped lookup, for deciding which organization a function belongs to. */
export const findFunctionById = (
  functionId: string
): Promise<CodeFunctionRecord | null> =>
  prisma.codeFunction.findUnique({ where: { id: functionId } });

export const getFunction = async ({
  functionId,
  organizationId,
}: FunctionScope): Promise<CodeFunctionWithFiles> => {
  const found = await prisma.codeFunction.findFirst({
    include: { files: { orderBy: FILE_ORDER } },
    where: { id: functionId, organizationId },
  });
  if (!found) {
    throw functionNotFound();
  }
  return found;
};

/** Creates a function with its runtime's starter files. */
export const createFunction = async (input: {
  actorId: string;
  description?: string | null | undefined;
  memoryMb?: number | undefined;
  name: string;
  organizationId: string;
  runtime: FunctionRuntime;
  timeoutSeconds?: number | undefined;
}): Promise<CodeFunctionWithFiles> => {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description) ?? null;
  checkLimits(input);
  const files = STARTER_FILES[input.runtime];
  const params = await paramsColumnsFor(input.runtime, files);
  try {
    return await prisma.$transaction(async (db) => {
      const created = await db.codeFunction.create({
        data: {
          ...params,
          createdById: input.actorId,
          description,
          files: { create: files },
          memoryMb: input.memoryMb ?? FUNCTION_LIMITS.defaultMemoryMb,
          name,
          organizationId: input.organizationId,
          runtime: input.runtime,
          sourceHash: sourceHashOf(files),
          timeoutSeconds:
            input.timeoutSeconds ?? FUNCTION_LIMITS.defaultTimeoutSeconds,
          updatedById: input.actorId,
        },
        include: { files: { orderBy: FILE_ORDER } },
      });
      await recordFunctionAudit(db, {
        action: "function.created",
        actorId: input.actorId,
        metadata: { name, runtime: input.runtime },
        organizationId: input.organizationId,
        targetId: created.id,
        targetType: "CodeFunction",
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw nameTaken(name);
    }
    throw error;
  }
};

/** Changes a function's name, description or limits. */
export const updateFunction = async (
  input: FunctionScope & {
    actorId: string;
    description?: string | null | undefined;
    memoryMb?: number | undefined;
    name?: string | undefined;
    timeoutSeconds?: number | undefined;
  }
): Promise<CodeFunctionRecord> => {
  const current = await getFunction(input);
  const name = input.name === undefined ? undefined : normalizeName(input.name);
  const description = normalizeDescription(input.description);
  checkLimits(input);
  const changes = {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(input.memoryMb === undefined ? {} : { memoryMb: input.memoryMb }),
    ...(input.timeoutSeconds === undefined
      ? {}
      : { timeoutSeconds: input.timeoutSeconds }),
  };
  try {
    return await prisma.$transaction(async (db) => {
      const updated = await db.codeFunction.update({
        data: { ...changes, updatedById: input.actorId },
        where: { id: current.id },
      });
      await recordFunctionAudit(db, {
        action: "function.updated",
        actorId: input.actorId,
        metadata: {
          changed: Object.keys(changes),
          name: updated.name,
          ...(name !== undefined && name !== current.name
            ? { previousName: current.name }
            : {}),
        },
        organizationId: current.organizationId,
        targetId: current.id,
        targetType: "CodeFunction",
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error) && name) {
      throw nameTaken(name);
    }
    throw error;
  }
};

/** Deletes a function with its files and run history. */
export const deleteFunction = async (
  input: FunctionScope & { actorId: string }
): Promise<void> => {
  const current = await getFunction(input);
  await prisma.$transaction(async (db) => {
    await db.codeFunction.delete({ where: { id: current.id } });
    await recordFunctionAudit(db, {
      action: "function.deleted",
      actorId: input.actorId,
      metadata: { name: current.name, runtime: current.runtime },
      organizationId: current.organizationId,
      targetId: current.id,
      targetType: "CodeFunction",
    });
  });
};

/**
 * Replaces every file of a function. `expectedHash` is the hash the editor
 * loaded; when someone saved in between, the save is refused.
 */
export const saveFiles = async (
  input: FunctionScope & {
    actorId: string;
    expectedHash: string;
    files: FunctionFileInput[];
  }
): Promise<CodeFunctionWithFiles> => {
  checkFiles(input.files);
  const current = await getFunction(input);
  const sourceHash = sourceHashOf(input.files);
  const params = await paramsColumnsFor(current.runtime, input.files);

  return prisma.$transaction(async (db) => {
    // Locks the row, so the hash check and the write cannot interleave.
    const locked = await db.$queryRaw<{ sourceHash: string }[]>`
      SELECT "sourceHash" FROM "code_function" WHERE "id" = ${current.id} FOR UPDATE`;
    if (locked[0]?.sourceHash !== input.expectedHash) {
      throw new FunctionsError(
        "SOURCE_CONFLICT",
        "These files were changed since you opened them. Reload to see the latest version."
      );
    }
    await db.codeFunctionFile.deleteMany({ where: { functionId: current.id } });
    const saved = await db.codeFunction.update({
      data: {
        ...params,
        files: { create: input.files },
        sourceHash,
        updatedById: input.actorId,
      },
      include: { files: { orderBy: FILE_ORDER } },
      where: { id: current.id },
    });
    await recordFunctionAudit(db, {
      action: "function.files_saved",
      actorId: input.actorId,
      metadata: { fileCount: input.files.length, name: current.name },
      organizationId: current.organizationId,
      targetId: current.id,
      targetType: "CodeFunction",
    });
    return saved;
  });
};
