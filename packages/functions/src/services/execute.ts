import { Prisma, prisma } from "@repo/database";
import { FUNCTION_LIMITS } from "../definition";
import { FunctionsError } from "../errors";
import { createOutputBuffer } from "../output-buffer";
import {
  type FunctionRunner,
  getRunner,
  type RunnerEvent,
  type RunnerRunRequest,
} from "../runner/client";

export type CodeFunctionRunRecord = Prisma.CodeFunctionRunGetPayload<object>;

const FLUSH_INTERVAL_MS = 500;
/** How long the runner gets to report a cancel before the stream is cut. */
const CANCEL_GRACE_MS = 10_000;

type StopReason = "canceled" | "shutdown";

interface ActiveRun {
  controller: AbortController;
  runner: FunctionRunner;
}

const active = new Map<string, ActiveRun>();

type ExitEvent = Extract<RunnerEvent, { type: "exit" }>;

interface Outcome {
  durationMs?: number | null;
  error?: string | null;
  exitCode?: number | null;
  result?: unknown;
  status: CodeFunctionRunRecord["status"];
  truncated?: boolean;
}

const outcomeOfExit = (exit: ExitEvent): Outcome => ({
  durationMs: exit.durationMs,
  error: exit.error ?? null,
  exitCode: exit.exitCode,
  result: exit.result,
  status: exit.status,
  truncated: exit.truncated,
});

const outcomeOfError = (
  error: unknown,
  reason: StopReason | undefined
): Outcome => {
  if (reason === "canceled") {
    return { status: "CANCELED" };
  }
  if (reason === "shutdown") {
    return {
      error: "The server stopped while this run was in progress.",
      status: "FAILED",
    };
  }
  if (error instanceof FunctionsError) {
    return { error: error.message, status: "FAILED" };
  }
  return {
    error: "The connection to the function runner was lost.",
    status: "FAILED",
  };
};

const resultColumn = (outcome: Outcome) => {
  if (outcome.status !== "SUCCEEDED" || outcome.result === undefined) {
    return Prisma.DbNull;
  }
  return outcome.result === null
    ? Prisma.JsonNull
    : (outcome.result as Prisma.InputJsonValue);
};

/** Deletes a function's runs beyond the newest `FUNCTION_LIMITS.runsKept`. */
export const pruneRuns = async (functionId: string): Promise<void> => {
  const boundary = await prisma.codeFunctionRun.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
    skip: FUNCTION_LIMITS.runsKept,
    where: { functionId },
  });
  if (boundary) {
    await prisma.codeFunctionRun.deleteMany({
      where: {
        functionId,
        number: { lte: boundary.number },
        status: { notIn: ["QUEUED", "RUNNING"] },
      },
    });
  }
};

/**
 * Runs a queued run on the runner and records everything it reports. Output
 * is appended to the row about every 500 ms; the final status, result and
 * timing are written when the runner reports the exit. Never throws.
 */
export const executeRun = async (
  request: RunnerRunRequest
): Promise<CodeFunctionRunRecord> => {
  const { runId } = request;
  const controller = new AbortController();
  const buffer = createOutputBuffer(FUNCTION_LIMITS.outputBytes);
  let writes = Promise.resolve();
  const flush = () => {
    const text = buffer.take();
    if (text) {
      writes = writes.then(async () => {
        await prisma.$executeRaw`
          UPDATE "code_function_run" SET "output" = "output" || ${text}
          WHERE "id" = ${runId}`;
      });
    }
    return writes;
  };
  const timer = setInterval(() => {
    flush().catch(() => undefined);
  }, FLUSH_INTERVAL_MS);

  let outcome: Outcome | undefined;
  try {
    const runner = getRunner();
    active.set(runId, { controller, runner });
    const started = await prisma.codeFunctionRun.updateMany({
      data: { startedAt: new Date(), status: "RUNNING" },
      where: { id: runId, status: "QUEUED" },
    });
    if (started.count === 0) {
      outcome = { status: "CANCELED" };
    } else {
      for await (const event of runner.run(request, controller.signal)) {
        if (event.type === "output") {
          buffer.append(event.data);
        } else if (event.type === "exit") {
          outcome = outcomeOfExit(event);
        }
      }
      outcome ??= {
        error: "The function runner ended the run without a result.",
        status: "FAILED",
      };
    }
  } catch (error) {
    outcome = outcomeOfError(
      error,
      controller.signal.aborted
        ? (controller.signal.reason as StopReason)
        : undefined
    );
  } finally {
    clearInterval(timer);
    active.delete(runId);
  }

  await flush().catch(() => undefined);
  const finished = await prisma.codeFunctionRun.update({
    data: {
      durationMs: outcome.durationMs ?? null,
      error: outcome.error ?? null,
      exitCode: outcome.exitCode ?? null,
      finishedAt: new Date(),
      outputTruncated: buffer.truncated() || outcome.truncated === true,
      result: resultColumn(outcome),
      status: outcome.status,
    },
    where: { id: runId },
  });
  await pruneRuns(finished.functionId).catch(() => undefined);
  return finished;
};

/**
 * Asks the runner to stop an active run; the stream then ends with a
 * `CANCELED` exit. If the runner does not answer in time, the stream is cut.
 * False when this process is not executing the run.
 */
export const stopActiveRun = (runId: string): boolean => {
  const run = active.get(runId);
  if (!run) {
    return false;
  }
  const cut = () => run.controller.abort("canceled" satisfies StopReason);
  run.runner.cancel(runId).then(
    (stopped) => {
      if (stopped) {
        setTimeout(cut, CANCEL_GRACE_MS).unref();
      } else {
        cut();
      }
    },
    () => cut()
  );
  return true;
};

/** Cuts every run's stream when the server shuts down. */
export const abortAllRuns = (): void => {
  for (const run of active.values()) {
    run.controller.abort("shutdown" satisfies StopReason);
  }
};

export const activeRunCount = (): number => active.size;
