import { prisma } from "@repo/database";
import type { JobDefinition, JobQueueProvider } from "@repo/jobs";
import { startTriggeredRun } from "../services/runs";

export const FLOW_SCHEDULE_JOB = "flow-schedule";

interface FlowScheduleJobPayload extends Record<string, unknown> {
  activationId: string;
}

/**
 * Fired by a schedule. Starts one run for the activation, unless it was
 * deactivated in the meantime.
 */
export const createFlowScheduleJob = (
  jobs: JobQueueProvider
): JobDefinition<FlowScheduleJobPayload> => ({
  handler: async ({ activationId }) => {
    const activation = await prisma.flowActivation.findUnique({
      include: { flow: { select: { organizationId: true } } },
      where: { id: activationId },
    });
    if (activation?.status !== "ACTIVE") {
      return;
    }
    await startTriggeredRun(
      {
        flowId: activation.flowId,
        flowVersionId: activation.flowVersionId,
        organizationId: activation.flow.organizationId,
        storeId: activation.storeId,
      },
      { payload: { scheduledAt: new Date().toISOString() }, type: "schedule" },
      jobs
    );
  },
  name: FLOW_SCHEDULE_JOB,
  retry: { attempts: 3, delayMs: 5000 },
});
