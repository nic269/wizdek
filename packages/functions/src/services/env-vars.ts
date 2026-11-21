import { prisma } from "@repo/database";
import { decryptSecret, encryptSecret } from "@repo/security/crypto";
import { recordFunctionAudit } from "../audit";
import { ENV_VAR_LIMITS, envVarNameProblem } from "../definition";
import { FunctionsError } from "../errors";
import { type FunctionScope, getFunction } from "./functions";

/** What the API shows of a variable: never its value. */
export interface EnvVarSummary {
  name: string;
  updatedAt: Date;
}

const envVarNotFound = () =>
  new FunctionsError("ENV_VAR_NOT_FOUND", "Variable not found.");

/** A function's variable names, alphabetically. */
export const listEnvVars = async (
  scope: FunctionScope
): Promise<EnvVarSummary[]> => {
  const fn = await getFunction(scope);
  return prisma.codeFunctionEnvVar.findMany({
    orderBy: { name: "asc" },
    select: { name: true, updatedAt: true },
    where: { functionId: fn.id },
  });
};

/** Creates or replaces a variable; the value is stored encrypted. */
export const setEnvVar = async (
  input: FunctionScope & { actorId: string; name: string; value: string }
): Promise<EnvVarSummary> => {
  const problem = envVarNameProblem(input.name);
  if (problem) {
    throw new FunctionsError("INVALID_ENV_VAR", problem);
  }
  if (input.value.length === 0) {
    throw new FunctionsError("INVALID_ENV_VAR", "Enter a value.");
  }
  if (Buffer.byteLength(input.value, "utf8") > ENV_VAR_LIMITS.valueBytes) {
    throw new FunctionsError(
      "INVALID_ENV_VAR",
      `A value can hold at most ${ENV_VAR_LIMITS.valueBytes / 1024} KB.`
    );
  }
  const fn = await getFunction(input);
  const valueEncrypted = encryptSecret(input.value);
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT 1 FROM "code_function" WHERE "id" = ${fn.id} FOR UPDATE`;
    const existing = await db.codeFunctionEnvVar.findUnique({
      select: { id: true },
      where: { functionId_name: { functionId: fn.id, name: input.name } },
    });
    if (!existing) {
      const count = await db.codeFunctionEnvVar.count({
        where: { functionId: fn.id },
      });
      if (count >= ENV_VAR_LIMITS.variables) {
        throw new FunctionsError(
          "INVALID_ENV_VAR",
          `A function can have at most ${ENV_VAR_LIMITS.variables} variables.`
        );
      }
    }
    const saved = await db.codeFunctionEnvVar.upsert({
      create: {
        functionId: fn.id,
        name: input.name,
        updatedById: input.actorId,
        valueEncrypted,
      },
      select: { name: true, updatedAt: true },
      update: { updatedById: input.actorId, valueEncrypted },
      where: { functionId_name: { functionId: fn.id, name: input.name } },
    });
    await recordFunctionAudit(db, {
      action: "function.env.set",
      actorId: input.actorId,
      metadata: { created: !existing, name: fn.name, variable: input.name },
      organizationId: fn.organizationId,
      targetId: fn.id,
      targetType: "CodeFunction",
    });
    return saved;
  });
};

export const deleteEnvVar = async (
  input: FunctionScope & { actorId: string; name: string }
): Promise<void> => {
  const fn = await getFunction(input);
  await prisma.$transaction(async (db) => {
    const deleted = await db.codeFunctionEnvVar.deleteMany({
      where: { functionId: fn.id, name: input.name },
    });
    if (deleted.count === 0) {
      throw envVarNotFound();
    }
    await recordFunctionAudit(db, {
      action: "function.env.deleted",
      actorId: input.actorId,
      metadata: { name: fn.name, variable: input.name },
      organizationId: fn.organizationId,
      targetId: fn.id,
      targetType: "CodeFunction",
    });
  });
};

/** A function's variables, decrypted, for one run. Never store the result. */
export const loadEnvForRun = async (
  functionId: string
): Promise<Record<string, string>> => {
  const rows = await prisma.codeFunctionEnvVar.findMany({
    select: { name: true, valueEncrypted: true },
    where: { functionId },
  });
  return Object.fromEntries(
    rows.map(({ name, valueEncrypted }) => [
      name,
      decryptSecret(valueEncrypted),
    ])
  );
};
