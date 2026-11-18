import {
  BACKUP_TIMEOUT_SECONDS,
  createDatabaseBackupJob,
  failStaleBackups,
} from "@repo/database-tools";
import {
  builtInRegistry,
  createAssetReader,
  createFlowRunJob,
  createFlowScheduleJob,
} from "@repo/flows";
import {
  abortAllRuns,
  failInterruptedInstalls,
  failInterruptedRuns,
} from "@repo/functions";
import {
  createLocalJobProvider,
  getJobProviderStatus,
  type JobQueueProvider,
} from "@repo/jobs";
import { keys } from "@repo/jobs/keys";
import { createPgBossJobProvider } from "@repo/jobs/pg-boss";

let provider: JobQueueProvider | undefined;

/**
 * The process-wide job provider, chosen by `JOBS_PROVIDER`. Created on first
 * use so importing this module never opens a database connection.
 */
export const getJobProvider = (): JobQueueProvider => {
  if (!provider) {
    const env = keys();
    provider =
      env.JOBS_PROVIDER === "pgboss"
        ? createPgBossJobProvider({
            connectionString: env.DATABASE_URL,
            workerEnabled: env.JOBS_WORKER_ENABLED,
          })
        : createLocalJobProvider();
  }
  return provider;
};

/**
 * Registers every background job the API can run. Called once at startup,
 * before the provider starts.
 */
export const registerJobs = (target: JobQueueProvider): void => {
  target.register(
    createFlowRunJob({
      readAsset: createAssetReader(),
      registry: builtInRegistry,
    })
  );
  target.register(createFlowScheduleJob(target));
  target.register(createDatabaseBackupJob());
};

/**
 * Fails backups that cannot finish any more. The in-memory provider loses
 * every job on restart; a durable one has stopped any job past its timeout.
 */
export const failInterruptedDatabaseBackups = (): Promise<number> => {
  const lostEverything = getJobProviderStatus().mode === "ephemeral";
  return failStaleBackups(
    new Date(Date.now() - (lostEverything ? 0 : BACKUP_TIMEOUT_SECONDS * 1000))
  );
};

/**
 * Fails function runs that a stopped process left queued or running, and
 * package installs it left in progress. Both are driven from this process,
 * so after a restart none of them can finish. Returns the number of runs.
 */
export const failInterruptedFunctionRuns = async (): Promise<number> => {
  const [runs] = await Promise.all([
    failInterruptedRuns(),
    failInterruptedInstalls(),
  ]);
  return runs;
};

/** Cuts the streams of running function runs when the server stops. */
export const abortFunctionRuns = (): void => abortAllRuns();
