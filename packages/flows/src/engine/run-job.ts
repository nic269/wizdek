import {
  createOrganizationJobScopeKey,
  type JobDefinition,
  type JobQueueProvider,
} from "@repo/jobs";
import { type ExecutorDependencies, executeFlowRun } from "./executor";

export const FLOW_RUN_JOB = "flow-run";

interface FlowRunJobPayload extends Record<string, unknown> {
  flowRunId: string;
}

/** One run at a time per store; runs for different stores go in parallel. */
export const storeConcurrencyKey = (storeId: string) => `store:${storeId}`;

/**
 * The background job that executes a flow run. The run's own tables hold its
 * progress, so a job delivered again after a crash or a restart simply
 * continues the run.
 */
export const createFlowRunJob = (
  deps: Omit<ExecutorDependencies, "signal">
): JobDefinition<FlowRunJobPayload> => ({
  handler: async ({ flowRunId }, { signal }) => {
    const outcome = await executeFlowRun(flowRunId, { ...deps, signal });
    if (outcome === "interrupted") {
      // Failing the attempt hands the run to the next worker that starts.
      throw new Error("The flow run was interrupted and will resume.");
    }
  },
  heartbeatSeconds: 30,
  name: FLOW_RUN_JOB,
  // Each restart of the process uses one attempt.
  retry: { attempts: 25, delayMs: 5000 },
  serialPerKey: true,
  timeoutSeconds: 86_400,
});

export const enqueueFlowRun = (
  provider: JobQueueProvider,
  run: { id: string; organizationId: string; storeId: string }
) =>
  provider.enqueue<FlowRunJobPayload>({
    concurrencyKey: storeConcurrencyKey(run.storeId),
    idempotencyKey: run.id,
    name: FLOW_RUN_JOB,
    payload: { flowRunId: run.id },
    scopeKey: createOrganizationJobScopeKey(run.organizationId),
  });
