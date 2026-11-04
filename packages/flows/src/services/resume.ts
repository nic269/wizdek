import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@repo/database";
import type { JobQueueProvider } from "@repo/jobs";
import { flowDefinitionSchema } from "../definition/schema";
import { enqueueFlowRun } from "../engine/run-job";
import { recordFlowAudit } from "./audit";
import { FlowServiceError } from "./errors";
import type { RunScope } from "./runs";

const RESUMABLE_STATUSES = new Set(["FAILED", "PARTIALLY_FAILED", "CANCELED"]);

/** Resume is deliberately limited to the read-only customer export pipeline. */
export const canResumeCustomerExport = (
  status: string,
  definition: unknown
): boolean => {
  if (!RESUMABLE_STATUSES.has(status)) {
    return false;
  }
  const parsed = flowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return false;
  }
  const { nodes, edges } = parsed.data;
  const trigger = nodes.find((node) =>
    ["trigger.manual", "trigger.schedule", "trigger.webhook"].includes(
      node.type
    )
  );
  const fetch = nodes.find((node) => node.type === "shopify.fetchCustomers");
  const csv = nodes.find((node) => node.type === "data.exportCsv");
  if (!(trigger && fetch && csv) || nodes.length !== 3 || edges.length !== 2) {
    return false;
  }
  return (
    edges.some(
      (edge) =>
        edge.source === trigger.id &&
        edge.target === fetch.id &&
        edge.sourceHandle === "main"
    ) &&
    edges.some(
      (edge) =>
        edge.source === fetch.id &&
        edge.target === csv.id &&
        edge.sourceHandle === "main"
    )
  );
};

export const resumeCustomerExport = async (
  scope: RunScope,
  actorId: string,
  jobs: JobQueueProvider
) => {
  const run = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope.runId}, 0))::text AS locked`;
    const current = await tx.flowRun.findFirst({
      include: { flowVersion: true },
      where: { id: scope.runId, organizationId: scope.organizationId },
    });
    if (!current) {
      throw new FlowServiceError("RUN_NOT_FOUND", "Run not found.");
    }
    if (
      !canResumeCustomerExport(current.status, current.flowVersion.definition)
    ) {
      throw new FlowServiceError(
        "RUN_NOT_RESUMABLE",
        "Only stopped customer export runs can be resumed."
      );
    }
    const failedItems = await tx.flowRunItem.findMany({
      select: { nodeId: true },
      where: { runId: current.id, status: "FAILED" },
    });
    await tx.flowRunItem.updateMany({
      data: { durationMs: null, error: Prisma.DbNull, status: "PENDING" },
      where: { runId: current.id, status: "FAILED" },
    });
    await tx.flowRunStep.updateMany({
      data: { completedAt: null, error: Prisma.DbNull, status: "PENDING" },
      where: {
        OR: [
          { status: { in: ["FAILED", "SKIPPED", "RUNNING"] } },
          { nodeId: { in: failedItems.map((item) => item.nodeId) } },
        ],
        runId: current.id,
      },
    });
    const updated = await tx.flowRun.update({
      data: {
        cancelRequestedAt: null,
        completedAt: null,
        error: Prisma.DbNull,
        status: "QUEUED",
      },
      where: { id: current.id },
    });
    await recordFlowAudit(tx, {
      action: "flow.run.resumed",
      actorId,
      metadata: { runNumber: current.number },
      organizationId: scope.organizationId,
      targetId: current.id,
      targetType: "FlowRun",
    });
    return updated;
  });
  try {
    await enqueueFlowRun(jobs, run, `${run.id}:resume:${randomUUID()}`);
  } catch (error) {
    await prisma.flowRun.updateMany({
      data: {
        completedAt: new Date(),
        error: {
          message:
            "Could not queue the resumed run. Resume again to retry; checkpoints are preserved.",
        },
        status: "FAILED",
      },
      where: { id: run.id, status: "QUEUED" },
    });
    throw error;
  }
  return run;
};
