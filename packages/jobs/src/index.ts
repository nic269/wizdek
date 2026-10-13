export type JobPayload = Record<string, unknown>;
export type JobRunStatus = "queued" | "running" | "completed" | "failed";

export const GLOBAL_JOB_SCOPE_KEY = "global";

export const createOrganizationJobScopeKey = (organizationId: string) => {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error(
      "Organization ID is required for an organization job scope."
    );
  }
  return `organization:${normalizedOrganizationId}`;
};

const resolveJobScopeKey = (scopeKey?: string) => {
  if (scopeKey === undefined) {
    return GLOBAL_JOB_SCOPE_KEY;
  }

  const normalizedScopeKey = scopeKey.trim();
  if (!normalizedScopeKey) {
    throw new Error("Job scope key cannot be empty.");
  }
  return normalizedScopeKey;
};

export interface JobDefinition<TPayload extends JobPayload = JobPayload> {
  handler(payload: TPayload): Promise<void>;
  name: string;
  retry?: { attempts: number; delayMs: number };
}

export interface EnqueueJobInput<TPayload extends JobPayload = JobPayload> {
  idempotencyKey?: string;
  name: string;
  payload: TPayload;
  scopeKey?: string;
}

export interface JobRunRecord {
  attempts: number;
  completedAt?: Date;
  error?: string | undefined;
  failedAt?: Date;
  idempotencyKey?: string;
  name: string;
  queuedAt: Date;
  runId: string;
  scopeKey: string;
  startedAt?: Date;
  status: JobRunStatus;
}

export interface JobQueueProvider {
  enqueue<TPayload extends JobPayload>(
    input: EnqueueJobInput<TPayload>
  ): Promise<{ runId: string }>;
  getRun(runId: string): Promise<JobRunRecord | undefined>;
  listRuns(): Promise<JobRunRecord[]>;
  register<TPayload extends JobPayload>(
    definition: JobDefinition<TPayload>
  ): void;
  waitUntilIdle(): Promise<void>;
}

export const getJobProviderStatus = () =>
  ({
    configured: true,
    mode: "ephemeral",
    provider: "local",
    state: "configured",
  }) as const;

export const createLocalJobProvider = (): JobQueueProvider => {
  const definitions = new Map<string, JobDefinition>();
  const runs = new Map<string, JobRunRecord>();
  const idempotency = new Map<string, string>();
  const pending = new Set<Promise<void>>();

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
        await definition.handler(payload);
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
      definitions.set(definition.name, definition);
    },
    async waitUntilIdle() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
};
