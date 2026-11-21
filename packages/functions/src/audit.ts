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
  | "function.schedule.deleted"
  | "function.grant.added"
  | "function.grant.removed"
  | "function.db.write";

/**
 * Records a function event. Metadata never includes source files, parameter
 * values, output or results; callers pass names, counts and numbers, plus
 * the SQL text of database writes so a change to data can be traced.
 */
export const recordFunctionAudit = (
  db: Prisma.TransactionClient,
  event: {
    action: FunctionAuditAction;
    /** Null for calls a run made without a person behind it. */
    actorId: string | null;
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
