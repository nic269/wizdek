import { type Prisma, prisma } from "@repo/database";
import {
  createOrganizationJobScopeKey,
  type JobQueueProvider,
} from "@repo/jobs";
import type { StorageProvider } from "@repo/storage";
import { recordDatabaseAudit } from "../audit";
import {
  type ConnectionScope,
  getConnection,
} from "../connections/connections";
import { DatabaseToolsError } from "../errors";

export type DatabaseBackupRecord = Prisma.DatabaseBackupGetPayload<object>;

export interface BackupScope {
  backupId: string;
  organizationId: string;
}

export const DATABASE_BACKUP_JOB = "database-backup";

export interface DatabaseBackupJobPayload extends Record<string, unknown> {
  backupId: string;
}

const LIST_LIMIT = 100;
const ACTIVE_STATUSES = ["QUEUED", "RUNNING"] as const;

const notFound = () =>
  new DatabaseToolsError("BACKUP_NOT_FOUND", "Backup not found.");

/** One backup at a time per connection, so a database is never dumped twice at once. */
export const connectionConcurrencyKey = (connectionId: string) =>
  `database-connection:${connectionId}`;

export const listBackups = (input: {
  connectionId?: string;
  organizationId: string;
}): Promise<DatabaseBackupRecord[]> =>
  prisma.databaseBackup.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    where: {
      organizationId: input.organizationId,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    },
  });

/** Unscoped lookup, for deciding which organization a backup belongs to. */
export const findBackupById = (
  backupId: string
): Promise<DatabaseBackupRecord | null> =>
  prisma.databaseBackup.findUnique({ where: { id: backupId } });

export const getBackup = async ({
  backupId,
  organizationId,
}: BackupScope): Promise<DatabaseBackupRecord> => {
  const backup = await prisma.databaseBackup.findFirst({
    where: { id: backupId, organizationId },
  });
  if (!backup) {
    throw notFound();
  }
  return backup;
};

/** Records a backup request and queues the job that carries it out. */
export const startBackup = async (
  input: { actorId: string; scope: ConnectionScope },
  jobs: JobQueueProvider
): Promise<DatabaseBackupRecord> => {
  const connection = await getConnection(input.scope);
  const backup = await prisma.$transaction(async (db) => {
    const created = await db.databaseBackup.create({
      data: {
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: connection.databaseName,
        engine: connection.engine,
        organizationId: connection.organizationId,
        requestedById: input.actorId,
      },
    });
    await recordDatabaseAudit(db, {
      action: "database.backup.started",
      actorId: input.actorId,
      metadata: {
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: connection.databaseName,
        host: connection.host,
      },
      organizationId: connection.organizationId,
      targetId: created.id,
      targetType: "DatabaseBackup",
    });
    return created;
  });

  try {
    await jobs.enqueue<DatabaseBackupJobPayload>({
      concurrencyKey: connectionConcurrencyKey(connection.id),
      idempotencyKey: backup.id,
      name: DATABASE_BACKUP_JOB,
      payload: { backupId: backup.id },
      scopeKey: createOrganizationJobScopeKey(connection.organizationId),
    });
  } catch (error) {
    await prisma.databaseBackup.update({
      data: {
        completedAt: new Date(),
        error: "The backup could not be queued.",
        status: "FAILED",
      },
      where: { id: backup.id },
    });
    throw error;
  }
  return backup;
};

/** The finished backup a download should serve. */
export const getDownloadableBackup = async (
  scope: BackupScope
): Promise<DatabaseBackupRecord & { fileName: string; objectKey: string }> => {
  const backup = await getBackup(scope);
  if (backup.status !== "COMPLETED" || !backup.objectKey || !backup.fileName) {
    throw new DatabaseToolsError(
      "BACKUP_NOT_READY",
      "This backup has no file to download."
    );
  }
  return { ...backup, fileName: backup.fileName, objectKey: backup.objectKey };
};

export const recordBackupDownload = (input: {
  actorId: string;
  backup: DatabaseBackupRecord;
}) =>
  recordDatabaseAudit(prisma, {
    action: "database.backup.downloaded",
    actorId: input.actorId,
    metadata: {
      connectionName: input.backup.connectionName,
      databaseName: input.backup.databaseName,
      fileName: input.backup.fileName ?? "",
    },
    organizationId: input.backup.organizationId,
    targetId: input.backup.id,
    targetType: "DatabaseBackup",
  });

/** Deletes a finished or failed backup and its file. */
export const deleteBackup = async (
  input: { actorId: string; scope: BackupScope },
  storage: StorageProvider
): Promise<void> => {
  const backup = await getBackup(input.scope);
  if ((ACTIVE_STATUSES as readonly string[]).includes(backup.status)) {
    throw new DatabaseToolsError(
      "BACKUP_BUSY",
      "This backup is still running and cannot be deleted yet."
    );
  }
  if (backup.objectKey) {
    await storage.deleteObject({ key: backup.objectKey });
  }
  await prisma.$transaction(async (db) => {
    await db.databaseBackup.delete({ where: { id: backup.id } });
    await recordDatabaseAudit(db, {
      action: "database.backup.deleted",
      actorId: input.actorId,
      metadata: {
        connectionName: backup.connectionName,
        databaseName: backup.databaseName,
        fileName: backup.fileName ?? "",
      },
      organizationId: backup.organizationId,
      targetId: backup.id,
      targetType: "DatabaseBackup",
    });
  });
};

/**
 * Marks backups that can no longer finish as failed: those older than
 * `startedBefore` that are still queued or running. Call at startup, so a
 * backup lost with its process does not keep its connection busy.
 */
export const failStaleBackups = async (
  startedBefore: Date
): Promise<number> => {
  const { count } = await prisma.databaseBackup.updateMany({
    data: {
      completedAt: new Date(),
      error: "The backup was interrupted by a restart. Start it again.",
      status: "FAILED",
    },
    where: {
      createdAt: { lt: startedBefore },
      status: { in: [...ACTIVE_STATUSES] },
    },
  });
  return count;
};

/** Names of the people who started the given backups, by user id. */
export const requesterNamesOf = async (
  backups: Pick<DatabaseBackupRecord, "requestedById">[]
): Promise<Map<string, string>> => {
  const ids = [
    ...new Set(backups.map(({ requestedById }) => requestedById)),
  ].filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    return new Map();
  }
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    where: { id: { in: ids } },
  });
  return new Map(users.map(({ id, name }) => [id, name]));
};
