export type JobPayload = Record<string, unknown>;
export type JobRunStatus = "queued" | "running" | "completed" | "failed";

export interface JobHandlerContext {
  runId: string;
  /** Aborted when the provider stops or the job exceeds its timeout. */
  signal: AbortSignal;
}

export interface JobDefinition<TPayload extends JobPayload = JobPayload> {
  handler(payload: TPayload, context: JobHandlerContext): Promise<void>;
  /**
   * How often a running job must prove it is alive. When the signal lapses,
   * for example because the process died, the job is delivered again.
   * Durable providers only; at least 10.
   */
  heartbeatSeconds?: number;
  name: string;
  /** `attempts` counts the first try. */
  retry?: { attempts: number; delayMs: number };
  /** Run at most one job per `concurrencyKey` at a time, in order. */
  serialPerKey?: boolean;
  /** Longest a single attempt may run. Durable providers cap this at 24 hours. */
  timeoutSeconds?: number;
}

export interface EnqueueJobInput<TPayload extends JobPayload = JobPayload> {
  /** Required for jobs whose definition sets `serialPerKey`. */
  concurrencyKey?: string;
  idempotencyKey?: string;
  name: string;
  payload: TPayload;
  scopeKey?: string;
  startAfterSeconds?: number;
}

export interface ScheduleJobInput<TPayload extends JobPayload = JobPayload> {
  /** Required for jobs whose definition sets `serialPerKey`. */
  concurrencyKey?: string;
  /** A five-field cron expression; schedules fire at most once a minute. */
  cron: string;
  /** Identifies this schedule among the job's schedules. */
  key: string;
  name: string;
  payload: TPayload;
  /** IANA time zone name; UTC when omitted. */
  timezone?: string;
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
  schedule<TPayload extends JobPayload>(
    input: ScheduleJobInput<TPayload>
  ): Promise<void>;
  /** Connects and begins running registered jobs. */
  start(): Promise<void>;
  /** Aborts running handlers' signals and waits for them to return. */
  stop(): Promise<void>;
  unschedule(name: string, key: string): Promise<void>;
  waitUntilIdle(): Promise<void>;
}

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

export const resolveJobScopeKey = (scopeKey?: string) => {
  if (scopeKey === undefined) {
    return GLOBAL_JOB_SCOPE_KEY;
  }

  const normalizedScopeKey = scopeKey.trim();
  if (!normalizedScopeKey) {
    throw new Error("Job scope key cannot be empty.");
  }
  return normalizedScopeKey;
};
