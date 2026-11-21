import { createHash, randomBytes } from "node:crypto";
import { type Prisma, prisma } from "@repo/database";
import { recordFunctionAudit } from "../audit";
import {
  ACTIVE_RUN_STATUSES,
  RUNTIME_ENV,
  RUNTIME_TOKEN_PREFIX,
} from "../definition";

const TOKEN_BYTES = 32;

export const hashRuntimeToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** A new token for one run's helper calls, and the hash the run keeps. */
export const newRuntimeToken = (): { hash: string; token: string } => {
  const token = `${RUNTIME_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { hash: hashRuntimeToken(token), token };
};

/** The values a run's helpers read, which are not secret except the token. */
export const runtimeEnvOf = (input: {
  functionId: string;
  organizationId: string;
  runId: string;
  token: string;
  trigger: string;
  url: string;
}): Record<string, string> => ({
  [RUNTIME_ENV.functionId]: input.functionId,
  [RUNTIME_ENV.organizationId]: input.organizationId,
  [RUNTIME_ENV.runId]: input.runId,
  [RUNTIME_ENV.token]: input.token,
  [RUNTIME_ENV.trigger]: input.trigger,
  [RUNTIME_ENV.url]: input.url,
});

/** The values of a run's environment to scrub from what it stores. */
export const secretValuesOf = (env: Record<string, string>): string[] =>
  Object.entries(env)
    .filter(
      ([name]) => !name.startsWith("WIZDEK_") || name === RUNTIME_ENV.token
    )
    .map(([, value]) => value);

/**
 * The run a helper call comes from, while it is queued or running. Null for
 * an unknown token or a run that has ended.
 */
export const authenticateRuntimeToken = async (token: string | null) => {
  if (!token?.startsWith(RUNTIME_TOKEN_PREFIX)) {
    return null;
  }
  const run = await prisma.codeFunctionRun.findUnique({
    include: {
      function: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          timeoutSeconds: true,
        },
      },
    },
    omit: { output: true },
    where: { runtimeTokenHash: hashRuntimeToken(token) },
  });
  return run && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)
    ? run
    : null;
};

export type RuntimeRun = NonNullable<
  Awaited<ReturnType<typeof authenticateRuntimeToken>>
>;

/** Counts one helper call on the run. */
export const countRuntimeCall = async (
  runId: string,
  kind: "DATABASE" | "STORE"
): Promise<void> => {
  await prisma.codeFunctionRun.update({
    data:
      kind === "DATABASE"
        ? { dbCallCount: { increment: 1 } }
        : { shopifyCallCount: { increment: 1 } },
    where: { id: runId },
  });
};

/**
 * Audits a database call of a run that may have changed data, with the
 * statements' text but never their parameters.
 */
export const recordDatabaseWrite = async (
  run: RuntimeRun,
  metadata: Prisma.InputJsonObject
): Promise<void> => {
  await prisma.$transaction((db) =>
    recordFunctionAudit(db, {
      action: "function.db.write",
      actorId: run.startedById,
      metadata: {
        functionId: run.function.id,
        name: run.function.name,
        runId: run.id,
        trigger: run.trigger,
        ...metadata,
      },
      organizationId: run.function.organizationId,
      targetId: run.id,
      targetType: "CodeFunctionRun",
    })
  );
};
