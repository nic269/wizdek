import type {
  JobDefinition,
  JobPayload,
  JobQueueProvider,
  JobRunRecord,
} from "./types";
import { resolveJobScopeKey } from "./types";

export * from "./types";

const selectedProvider = () =>
  process.env.JOBS_PROVIDER === "pgboss" ? "pgboss" : "local";

/**
 * Reports which provider the environment selects. The local provider keeps
 * jobs in memory, so they are lost when the process exits.
 */
export const getJobProviderStatus = () =>
  selectedProvider() === "pgboss"
    ? ({
        configured: true,
        mode: "durable",
        provider: "pgboss",
        state: "configured",
      } as const)
    : ({
        configured: true,
        mode: "ephemeral",
        provider: "local",
        state: "configured",
      } as const);

export const createLocalJobProvider = (): JobQueueProvider => {
  const definitions = new Map<string, JobDefinition>();
  const runs = new Map<string, JobRunRecord>();
  const idempotency = new Map<string, string>();
  const pending = new Set<Promise<void>>();
  const shutdown = new AbortController();

  const delay = (delayMs: number) =>
    new Promise((resolve) => setTimeout(resolve, delayMs));

  const execute = async (
    runId: string,
    definition: JobDefinition,
    payload: JobPayload
  ) => {
    const run = runs.get(runId);
    if (!run) {
      return;
    }

    run.status = "running";
    run.startedAt = new Date();
    const maxAttempts = definition.retry?.attempts ?? 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      run.attempts = attempt;
      try {
        await definition.handler(payload, { runId, signal: shutdown.signal });
        run.status = "completed";
        run.completedAt = new Date();
        run.error = undefined;
        return;
      } catch (error) {
        run.error =
          error instanceof Error ? error.message : "Unknown job error";
        if (attempt < maxAttempts) {
          await delay(definition.retry?.delayMs ?? 0);
        }
      }
    }

    run.status = "failed";
    run.failedAt = new Date();
  };

  const schedule = (
    runId: string,
    definition: JobDefinition,
    payload: JobPayload
  ) => {
    const task = execute(runId, definition, payload).finally(() =>
      pending.delete(task)
    );
    pending.add(task);
  };

  return {
    enqueue(input) {
      try {
        const scopeKey = resolveJobScopeKey(input.scopeKey);
        const key = input.idempotencyKey
          ? JSON.stringify([scopeKey, input.name, input.idempotencyKey])
          : undefined;
        const existingRunId = key ? idempotency.get(key) : undefined;
        if (existingRunId) {
          return Promise.resolve({ runId: existingRunId });
        }

        const definition = definitions.get(input.name);
        if (!definition) {
          throw new Error(`Job definition not registered: ${input.name}`);
        }

        const runId = crypto.randomUUID();
        runs.set(runId, {
          attempts: 0,
          name: input.name,
          queuedAt: new Date(),
          runId,
          scopeKey,
          status: "queued",
          ...(input.idempotencyKey
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
        });
        if (key) {
          idempotency.set(key, runId);
        }
        schedule(runId, definition, input.payload);

        return Promise.resolve({ runId });
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getRun(runId) {
      return Promise.resolve(runs.get(runId));
    },
    listRuns() {
      return Promise.resolve(
        [...runs.values()].sort(
          (left, right) => left.queuedAt.getTime() - right.queuedAt.getTime()
        )
      );
    },
    register(definition) {
      definitions.set(definition.name, definition as JobDefinition);
    },
    schedule() {
      return Promise.reject(
        new Error("Schedules are not supported by the local job provider.")
      );
    },
    start() {
      return Promise.resolve();
    },
    async stop() {
      shutdown.abort();
      await Promise.allSettled([...pending]);
    },
    unschedule() {
      return Promise.reject(
        new Error("Schedules are not supported by the local job provider.")
      );
    },
    async waitUntilIdle() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
};
