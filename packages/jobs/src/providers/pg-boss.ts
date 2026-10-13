import { createHash, randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import {
  type EnqueueJobInput,
  type JobDefinition,
  type JobPayload,
  type JobQueueProvider,
  type JobRunRecord,
  type JobRunStatus,
  resolveJobScopeKey,
} from "../types";

export interface PgBossJobProviderOptions {
  connectionString: string;
  /** Seconds between checks for released keys. Lower it in tests. */
  maintenanceIntervalSeconds?: number;
  /**
   * Seconds between checks of one queue for timed-out jobs and lapsed
   * heartbeats. A dead worker's job is delivered again within this interval
   * plus the job's heartbeat. Defaults to 60.
   */
  monitorIntervalSeconds?: number;
  /** Seconds between a worker's checks for new jobs. */
  pollingIntervalSeconds?: number;
  /** Connections pg-boss may hold, apart from the application's own pool. */
  poolSize?: number;
  /** Postgres schema holding the queue tables. */
  schema?: string;
  /** Seconds between checks for lapsed heartbeats and expired jobs. */
  superviseIntervalSeconds?: number;
  /** False on a process that should enqueue jobs but not run them. */
  workerEnabled?: boolean;
}

/** What is stored as a job's data, so a run can be described from the queue alone. */
interface JobEnvelope {
  idempotencyKey?: string;
  payload: JobPayload;
  runId?: string;
  scopeKey: string;
}

interface StoredJob {
  completedOn?: Date | null;
  createdOn: Date;
  data: JobEnvelope;
  id: string;
  name: string;
  output?: unknown;
  retryCount: number;
  startedOn?: Date | null;
  state: string;
}

const MAX_EXPIRE_SECONDS = 86_400;
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEAD_LETTER_SUFFIX = "__dead";
const IDLE_POLL_MS = 100;

const STATUS_BY_STATE: Record<string, JobRunStatus> = {
  active: "running",
  cancelled: "failed",
  completed: "completed",
  created: "queued",
  failed: "failed",
  retry: "queued",
};

/** A stable job id, so the same idempotency key maps to the same job. */
const idempotentRunId = (scopeKey: string, name: string, key: string) => {
  const hex = createHash("sha256")
    .update(JSON.stringify([scopeKey, name, key]))
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};

const errorMessage = (output: unknown): string | undefined => {
  if (typeof output === "object" && output !== null && "message" in output) {
    return String(output.message);
  }
};

const toRunRecord = (job: StoredJob, name: string): JobRunRecord => {
  const status = STATUS_BY_STATE[job.state] ?? "queued";
  const started = Boolean(job.startedOn);
  return {
    attempts: started ? job.retryCount + 1 : 0,
    name,
    queuedAt: job.createdOn,
    runId: job.data.runId ?? job.id,
    scopeKey: job.data.scopeKey,
    status,
    ...(job.data.idempotencyKey
      ? { idempotencyKey: job.data.idempotencyKey }
      : {}),
    ...(job.startedOn ? { startedAt: job.startedOn } : {}),
    ...(status === "completed" && job.completedOn
      ? { completedAt: job.completedOn }
      : {}),
    ...(status === "failed"
      ? {
          error: errorMessage(job.output) ?? "Job failed",
          failedAt: job.completedOn ?? new Date(),
        }
      : {}),
  };
};

/**
 * A job provider that keeps jobs in Postgres through pg-boss, so queued and
 * running work survives a restart. pg-boss manages its own schema, separate
 * from the application's tables.
 */
export const createPgBossJobProvider = (
  options: PgBossJobProviderOptions
): JobQueueProvider => {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    max: options.poolSize ?? 4,
    schema: options.schema ?? "pgboss",
    ...(options.monitorIntervalSeconds
      ? { monitorIntervalSeconds: options.monitorIntervalSeconds }
      : {}),
    ...(options.superviseIntervalSeconds
      ? { superviseIntervalSeconds: options.superviseIntervalSeconds }
      : {}),
  });
  const definitions = new Map<string, JobDefinition>();
  const prepared = new Map<string, Promise<void>>();
  const running = new Set<Promise<void>>();
  let started = false;
  let releaseTimer: NodeJS.Timeout | undefined;

  // pg-boss reports background failures here; without a listener an error
  // event would crash the process.
  boss.on("error", (error) => {
    console.error("jobs.pgboss_error", error);
  });

  const deadLetterOf = (name: string) => `${name}${DEAD_LETTER_SUFFIX}`;
  const retryLimitOf = (definition: JobDefinition) =>
    Math.max(0, (definition.retry?.attempts ?? 1) - 1);

  const ensureQueue = async (definition: JobDefinition) => {
    const deadLetter = deadLetterOf(definition.name);
    if (!(await boss.getQueue(deadLetter))) {
      await boss.createQueue(deadLetter);
    }
    const settings = {
      deadLetter,
      expireInSeconds: Math.min(
        definition.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        MAX_EXPIRE_SECONDS
      ),
      retryDelay: Math.ceil((definition.retry?.delayMs ?? 0) / 1000),
      retryLimit: retryLimitOf(definition),
      ...(definition.heartbeatSeconds
        ? { heartbeatSeconds: definition.heartbeatSeconds }
        : {}),
    };
    if (await boss.getQueue(definition.name)) {
      await boss.updateQueue(definition.name, settings);
    } else {
      await boss.createQueue(definition.name, {
        ...settings,
        policy: definition.serialPerKey ? "key_strict_fifo" : "standard",
      });
    }
  };

  const runHandler = async (
    definition: JobDefinition,
    job: {
      data: JobEnvelope;
      id: string;
      retryCount: number;
      signal: AbortSignal;
    }
  ) => {
    const runId = job.data.runId ?? job.id;
    try {
      await definition.handler(job.data.payload, { runId, signal: job.signal });
    } catch (error) {
      const isFinalAttempt = job.retryCount >= retryLimitOf(definition);
      if (!(definition.serialPerKey && isFinalAttempt) || job.signal.aborted) {
        throw error;
      }
      // A permanently failed job keeps its key blocked under strict FIFO.
      // Failing it here copies it to the dead-letter queue, where its outcome
      // stays readable; deleting it then lets the key's next job run.
      await boss.fail(definition.name, job.id, {
        message: error instanceof Error ? error.message : "Unknown job error",
      });
      await boss.deleteJob(definition.name, job.id);
    }
  };

  const startWorker = async (definition: JobDefinition) => {
    await boss.work<JobEnvelope>(
      definition.name,
      { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        for (const job of jobs) {
          const task = runHandler(definition, job);
          running.add(task);
          try {
            await task;
          } finally {
            running.delete(task);
          }
        }
      }
    );
  };

  const prepare = (definition: JobDefinition): Promise<void> => {
    const existing = prepared.get(definition.name);
    if (existing) {
      return existing;
    }
    const task = (async () => {
      await ensureQueue(definition);
      if (options.workerEnabled ?? true) {
        await startWorker(definition);
      }
    })();
    prepared.set(definition.name, task);
    return task;
  };

  const requireDefinition = (name: string) => {
    const definition = definitions.get(name);
    if (!definition) {
      throw new Error(`Job definition not registered: ${name}`);
    }
    return definition;
  };

  const requireStarted = async (name: string) => {
    if (!started) {
      throw new Error("The job provider has not been started.");
    }
    const definition = requireDefinition(name);
    await prepare(definition);
    return definition;
  };

  const concurrencyOptions = (
    definition: JobDefinition,
    concurrencyKey: string | undefined
  ) => {
    if (!definition.serialPerKey) {
      return {};
    }
    if (!concurrencyKey) {
      throw new Error(
        `Job ${definition.name} runs one at a time per key and needs a concurrencyKey.`
      );
    }
    return { singletonKey: concurrencyKey };
  };

  /**
   * Jobs failed by the supervisor (a lapsed heartbeat or timeout on the last
   * attempt) never pass through the handler wrapper, so their keys are
   * released here.
   */
  const releaseBlockedKeys = async () => {
    for (const definition of definitions.values()) {
      if (!definition.serialPerKey) {
        continue;
      }
      const blocked = await boss.getBlockedKeys(definition.name);
      for (const key of blocked) {
        const jobs = (await boss.findJobs(definition.name, {
          key,
        })) as unknown as StoredJob[];
        const failed = jobs
          .filter(({ state }) => state === "failed")
          .map(({ id }) => id);
        if (failed.length > 0) {
          await boss.deleteJob(definition.name, failed);
        }
      }
    }
  };

  const findStored = async (name: string): Promise<StoredJob[]> => {
    const [live, dead] = await Promise.all([
      boss.findJobs(name, {}),
      boss.findJobs(deadLetterOf(name), {}),
    ]);
    const liveJobs = live as unknown as StoredJob[];
    const known = new Set(liveJobs.map(({ data, id }) => data.runId ?? id));
    // A dead-letter copy stands in for a job that was removed to free its key.
    const deadJobs = (dead as unknown as StoredJob[])
      .filter(({ data }) => data.runId && !known.has(data.runId))
      .map((job) => ({ ...job, state: "failed" }));
    return [...liveJobs, ...deadJobs];
  };

  return {
    async enqueue<TPayload extends JobPayload>(
      input: EnqueueJobInput<TPayload>
    ) {
      const scopeKey = resolveJobScopeKey(input.scopeKey);
      const definition = await requireStarted(input.name);
      const runId = input.idempotencyKey
        ? idempotentRunId(scopeKey, input.name, input.idempotencyKey)
        : randomUUID();
      const envelope: JobEnvelope = {
        payload: input.payload,
        runId,
        scopeKey,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      };
      // A job that already exists under this id is left as it is.
      await boss.send(input.name, envelope, {
        id: runId,
        ...concurrencyOptions(definition, input.concurrencyKey),
        ...(input.startAfterSeconds
          ? { startAfter: input.startAfterSeconds }
          : {}),
      });
      return { runId };
    },
    async getRun(runId) {
      for (const name of definitions.keys()) {
        const job = (await findStored(name)).find(
          ({ data, id }) => (data.runId ?? id) === runId
        );
        if (job) {
          return toRunRecord(job, name);
        }
      }
    },
    async listRuns() {
      const runs: JobRunRecord[] = [];
      for (const name of definitions.keys()) {
        const jobs = await findStored(name);
        runs.push(...jobs.map((job) => toRunRecord(job, name)));
      }
      return runs.sort(
        (left, right) => left.queuedAt.getTime() - right.queuedAt.getTime()
      );
    },
    register(definition) {
      definitions.set(definition.name, definition as JobDefinition);
      if (started) {
        prepare(definition as JobDefinition).catch((error: unknown) => {
          console.error("jobs.register_failed", error);
        });
      }
    },
    async schedule(input) {
      const definition = await requireStarted(input.name);
      const envelope: JobEnvelope = {
        payload: input.payload,
        scopeKey: resolveJobScopeKey(),
      };
      await boss.schedule(input.name, input.cron, envelope, {
        key: input.key,
        ...(input.timezone ? { tz: input.timezone } : {}),
        ...concurrencyOptions(definition, input.concurrencyKey),
      });
    },
    async start() {
      if (started) {
        return;
      }
      await boss.start();
      started = true;
      await Promise.all([...definitions.values()].map(prepare));
      await releaseBlockedKeys();
      releaseTimer = setInterval(
        () => {
          releaseBlockedKeys().catch((error: unknown) => {
            console.error("jobs.release_blocked_keys_failed", error);
          });
        },
        (options.maintenanceIntervalSeconds ?? 30) * 1000
      );
      releaseTimer.unref();
    },
    async stop() {
      if (!started) {
        return;
      }
      started = false;
      clearInterval(releaseTimer);
      prepared.clear();
      // Aborts every running handler's signal, then waits for them to return.
      await boss.stop({ graceful: true, timeout: 30_000 });
      await Promise.allSettled([...running]);
    },
    async unschedule(name, key) {
      await requireStarted(name);
      await boss.unschedule(name, key);
    },
    async waitUntilIdle() {
      const isBusy = async () => {
        for (const name of definitions.keys()) {
          const jobs = (await boss.findJobs(
            name,
            {}
          )) as unknown as StoredJob[];
          if (
            jobs.some(
              ({ state }) =>
                STATUS_BY_STATE[state] === "queued" || state === "active"
            )
          ) {
            return true;
          }
        }
        return false;
      };
      while (await isBusy()) {
        await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
      }
    },
  };
};
