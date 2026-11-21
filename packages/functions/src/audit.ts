import type { Prisma } from "@repo/database";

export type FunctionAuditAction =
  | "function.created"
  | "function.updated"
  | "function.deleted"
  | "function.files_saved"
  | "function.deps.reinstalled"
  | "function.run.started"
  | "function.run.canceled"
  | "function.env.set"
  | "function.env.deleted"
  | "function.http.enabled"
  | "function.http.rotated"
  | "function.http.disabled"
  | "function.schedule.created"
  | "function.schedule.updated"
  | "function.schedule.deleted";

/**
 * Records a function event. Metadata never includes source text, parameter
 * values, output or results; callers pass names, counts and numbers only.
 */
export const recordFunctionAudit = (
  db: Prisma.TransactionClient,
  event: {
    action: FunctionAuditAction;
    actorId: string;
    metadata?: Prisma.InputJsonObject;
    organizationId: string;
    targetId: string;
    targetType: "CodeFunction" | "CodeFunctionRun" | "CodeFunctionSchedule";
  }
) =>
  db.auditLog.create({
    data: {
      action: event.action,
      actorId: event.actorId,
      organizationId: event.organizationId,
      targetId: event.targetId,
      targetType: event.targetType,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    },
  });
