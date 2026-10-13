import {
  builtInRegistry,
  createAssetReader,
  createFlowRunJob,
  createFlowScheduleJob,
} from "@repo/flows";
import { createLocalJobProvider, type JobQueueProvider } from "@repo/jobs";
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
};
