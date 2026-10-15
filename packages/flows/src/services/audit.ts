import type { Prisma } from "@repo/database";

export type FlowAuditAction =
  | "flow.created"
  | "flow.updated"
  | "flow.archived"
  | "flow.restored"
  | "flow.version_saved"
  | "flow.run.started"
  | "flow.run.canceled"
  | "flow.activated"
  | "flow.deactivated";

/**
 * Records something a person did to a flow. Metadata holds names, numbers
 * and store domains only, never run inputs or item data.
 */
export const recordFlowAudit = (
  db: Prisma.TransactionClient,
  event: {
    action: FlowAuditAction;
    actorId: string;
    metadata: Prisma.InputJsonObject;
    organizationId: string;
    targetId: string;
    targetType: "Flow" | "FlowRun" | "FlowActivation";
  }
) =>
  db.auditLog.create({
    data: {
      action: event.action,
      actorId: event.actorId,
      metadata: event.metadata,
      organizationId: event.organizationId,
      targetId: event.targetId,
      targetType: event.targetType,
    },
  });
