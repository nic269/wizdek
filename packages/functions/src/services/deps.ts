import { prisma } from "@repo/database";
import { recordFunctionAudit } from "../audit";
import {
  DEPS_LOG_CHARACTERS,
  type FunctionFileInput,
  type FunctionRuntime,
  manifestsOf,
} from "../definition";
import { FunctionsError } from "../errors";
import { getRunner } from "../runner/client";
import { sourceHashOf } from "../source";
import {
  type CodeFunctionWithFiles,
  type FunctionScope,
  getFunction,
} from "./functions";

/** Columns that describe a function's packages. */
export interface DepsColumns {
  depsBuiltAt: Date | null;
  depsError: string | null;
  depsHash: string | null;
  depsKey: string | null;
  depsLog: string;
  depsStatus: "NONE" | "BUILDING";
}

/** A hash of the manifests, or null when the function installs nothing. */
export const depsHashOf = (
  runtime: FunctionRuntime,
  files: readonly FunctionFileInput[]
): string | null => {
  const manifests = manifestsOf(runtime, files);
  return manifests.length > 0 ? sourceHashOf(manifests) : null;
};

/** The columns for a fresh start: building when there are manifests. */
export const freshDepsColumns = (hash: string | null): DepsColumns => ({
  depsBuiltAt: null,
  depsError: null,
  depsHash: hash,
  depsKey: null,
  depsLog: "",
  depsStatus: hash === null ? "NONE" : "BUILDING",
});

/** Keeps the end of an install's output. */
const createLogTail = () => {
  let text = "";
  return {
    append(data: string) {
      text = (text + data).slice(-DEPS_LOG_CHARACTERS);
    },
    text: () => text,
  };
};

const connectionLost = "The connection to the function runner was lost.";

/** Installs in progress in this process, by function and manifest hash. */
const installing = new Map<string, Promise<string | null>>();

/**
 * Installs a function's packages on the runner and records the outcome on
 * the function, unless its manifests changed in the meantime. Resolves with
 * the cache key, or null when the install failed. Never rejects.
 */
export const installDeps = (fn: {
  files: readonly FunctionFileInput[];
  id: string;
  runtime: FunctionRuntime;
}): Promise<string | null> => {
  const manifests = manifestsOf(fn.runtime, fn.files);
  if (manifests.length === 0) {
    return Promise.resolve(null);
  }
  const hash = sourceHashOf(manifests);
  const id = `${fn.id}:${hash}`;
  const pending = installing.get(id);
  if (pending) {
    return pending;
  }

  const install = async (): Promise<string | null> => {
    const log = createLogTail();
    let key: string | null = null;
    let error: string | null = connectionLost;
    try {
      for await (const event of getRunner().buildDeps({
        manifests,
        runtime: fn.runtime,
      })) {
        if (event.type === "output") {
          log.append(event.data);
        } else if (event.status === "READY") {
          ({ key } = event);
          error = null;
        } else {
          error = event.error ?? "The install failed.";
        }
      }
    } catch (caught) {
      error =
        caught instanceof FunctionsError ? caught.message : connectionLost;
    }
    // Only the install for the manifests the function still has may say
    // how its packages stand.
    await prisma.codeFunction.updateMany({
      data: key
        ? {
            depsBuiltAt: new Date(),
            depsError: null,
            depsKey: key,
            depsLog: log.text(),
            depsStatus: "READY",
          }
        : {
            depsError: error,
            depsKey: null,
            depsLog: log.text(),
            depsStatus: "FAILED",
          },
      where: { depsHash: hash, id: fn.id },
    });
    return key;
  };

  const promise = install()
    .catch((caught: unknown) => {
      console.error("functions.deps_install_failed", caught);
      return null;
    })
    .finally(() => installing.delete(id));
  installing.set(id, promise);
  return promise;
};

/** Starts an install without waiting for it. */
export const startDepsInstall = (fn: CodeFunctionWithFiles): void => {
  if (fn.depsStatus === "BUILDING") {
    installDeps(fn).catch(() => undefined);
  }
};

/**
 * Installs a function's packages again, e.g. after a failure or when the
 * registry served a broken release. Without manifests it clears the status.
 */
export const reinstallDeps = async (
  input: FunctionScope & { actorId: string }
): Promise<CodeFunctionWithFiles> => {
  const current = await getFunction(input);
  const hash = depsHashOf(current.runtime, current.files);
  const updated = await prisma.$transaction(async (db) => {
    const saved = await db.codeFunction.update({
      data: freshDepsColumns(hash),
      include: { files: { orderBy: { path: "asc" } } },
      where: { id: current.id },
    });
    await recordFunctionAudit(db, {
      action: "function.deps.reinstalled",
      actorId: input.actorId,
      metadata: { name: current.name },
      organizationId: current.organizationId,
      targetId: current.id,
      targetType: "CodeFunction",
    });
    return saved;
  });
  startDepsInstall(updated);
  return updated;
};

/**
 * Installs again for a run whose packages the runner evicted, and resolves
 * with the new key, or null when the install failed.
 */
export const reinstallForRun = async (fn: {
  depsHash: string | null;
  files: readonly FunctionFileInput[];
  id: string;
  runtime: FunctionRuntime;
}): Promise<string | null> => {
  await prisma.codeFunction.updateMany({
    data: { depsKey: null, depsStatus: "BUILDING" },
    where: { depsHash: fn.depsHash, id: fn.id },
  });
  return installDeps(fn);
};

/**
 * Marks installs a stopped server left in progress as failed. Call once at
 * startup, before new installs begin.
 */
export const failInterruptedInstalls = async (): Promise<number> => {
  const result = await prisma.codeFunction.updateMany({
    data: {
      depsError:
        "The server restarted while the packages were installing. Install them again.",
      depsStatus: "FAILED",
    },
    where: { depsStatus: "BUILDING" },
  });
  return result.count;
};
