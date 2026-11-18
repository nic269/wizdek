import type { Prisma } from "@repo/database";

export type FunctionAuditAction =
  | "function.created"
  | "function.updated"
  | "function.deleted"
  | "function.files_saved"
  | "function.deps.reinstalled"
  | "function.run.started"
  | "function.run.canceled";

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
    targetType: "CodeFunction" | "CodeFunctionRun";
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
