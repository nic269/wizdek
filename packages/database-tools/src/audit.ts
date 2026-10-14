import type { Prisma } from "@repo/database";

export type DatabaseAuditAction =
  | "database.connection.created"
  | "database.connection.updated"
  | "database.connection.deleted"
  | "database.backup.started"
  | "database.backup.downloaded"
  | "database.backup.deleted";

/**
 * Records a database tool event. Metadata must never include a connection
 * URL or password; callers pass names, hosts and identifiers only.
 */
export const recordDatabaseAudit = (
  db: Prisma.TransactionClient,
  event: {
    action: DatabaseAuditAction;
    actorId: string;
    metadata?: Prisma.InputJsonObject;
    organizationId: string;
    targetId: string;
    targetType: "DatabaseBackup" | "DatabaseConnection";
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
