import {
  checkConnection,
  createConnection,
  type DatabaseBackupRecord,
  type DatabaseConnectionRecord,
  deleteBackup,
  deleteConnection,
  listBackups,
  listConnections,
  requesterNamesOf,
  startBackup,
  updateConnection,
} from "@repo/database-tools";
import { getStorageProvider } from "@repo/storage";
import { getJobProvider } from "../jobs";
import {
  requireBackupPermission,
  requireConnectionPermission,
  requireOrganizationAccess,
} from "./authz";
import { withDatabaseErrors } from "./database-errors";
import { os } from "./implementer";

/** Every field but the encrypted URL. */
export const toPublicConnection = (connection: DatabaseConnectionRecord) => ({
  createdAt: connection.createdAt,
  databaseName: connection.databaseName,
  engine: connection.engine,
  environment: connection.environment,
  host: connection.host,
  id: connection.id,
  lastCheckError: connection.lastCheckError,
  lastCheckedAt: connection.lastCheckedAt,
  name: connection.name,
  organizationId: connection.organizationId,
  port: connection.port,
  serverVersion: connection.serverVersion,
  sslMode: connection.sslMode,
  updatedAt: connection.updatedAt,
  username: connection.username,
});

export const toPublicBackup = (
  backup: DatabaseBackupRecord,
  requesterNames: Map<string, string> = new Map()
) => ({
  checksumSha256: backup.checksumSha256,
  completedAt: backup.completedAt,
  connectionId: backup.connectionId,
  connectionName: backup.connectionName,
  createdAt: backup.createdAt,
  databaseName: backup.databaseName,
  engine: backup.engine,
  error: backup.error,
  fileName: backup.fileName,
  id: backup.id,
  organizationId: backup.organizationId,
  requestedByName: backup.requestedById
    ? (requesterNames.get(backup.requestedById) ?? null)
    : null,
  serverVersion: backup.serverVersion,
  sizeBytes: backup.sizeBytes === null ? null : backup.sizeBytes.toString(),
  startedAt: backup.startedAt,
  status: backup.status,
  toolVersion: backup.toolVersion,
});

const scopeOf = (connection: DatabaseConnectionRecord) => ({
  connectionId: connection.id,
  organizationId: connection.organizationId,
});

export const databaseConnectionsRouter = {
  check: os.databaseConnections.check.handler(async ({ context, input }) => {
    const { connection } = await requireConnectionPermission(
      context.headers,
      input.connectionId,
      "read"
    );
    const checked = await withDatabaseErrors(() =>
      checkConnection(scopeOf(connection))
    );
    return { data: toPublicConnection(checked) };
  }),
  create: os.databaseConnections.create.handler(async ({ context, input }) => {
    const user = await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "databases",
      "manage"
    );
    const connection = await withDatabaseErrors(() =>
      createConnection({
        actorId: user.id,
        environment: input.environment,
        name: input.name,
        organizationId: input.organizationId,
        url: input.url,
      })
    );
    return { data: toPublicConnection(connection) };
  }),
  delete: os.databaseConnections.delete.handler(async ({ context, input }) => {
    const { connection, user } = await requireConnectionPermission(
      context.headers,
      input.connectionId,
      "manage"
    );
    await withDatabaseErrors(() =>
      deleteConnection({ actorId: user.id, scope: scopeOf(connection) })
    );
    return { data: { id: connection.id } };
  }),
  get: os.databaseConnections.get.handler(async ({ context, input }) => {
    const { connection } = await requireConnectionPermission(
      context.headers,
      input.connectionId,
      "read"
    );
    return { data: toPublicConnection(connection) };
  }),
  list: os.databaseConnections.list.handler(async ({ context, input }) => {
    await requireOrganizationAccess(
      context.headers,
      input.organizationId,
      "databases",
      "read"
    );
    const connections = await listConnections(input.organizationId);
    return { data: connections.map(toPublicConnection) };
  }),
  update: os.databaseConnections.update.handler(async ({ context, input }) => {
    const { connection, user } = await requireConnectionPermission(
      context.headers,
      input.connectionId,
      "manage"
    );
    const updated = await withDatabaseErrors(() =>
      updateConnection({
        actorId: user.id,
        environment: input.environment,
        scope: scopeOf(connection),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.url ? { url: input.url } : {}),
      })
    );
    return { data: toPublicConnection(updated) };
  }),
};

export const databaseBackupsRouter = {
  delete: os.databaseBackups.delete.handler(async ({ context, input }) => {
    const { backup, user } = await requireBackupPermission(
      context.headers,
      input.backupId,
      "backup"
    );
    await withDatabaseErrors(() =>
      deleteBackup(
        {
          actorId: user.id,
          scope: {
            backupId: backup.id,
            organizationId: backup.organizationId,
          },
        },
        getStorageProvider()
      )
    );
    return { data: { id: backup.id } };
  }),
  get: os.databaseBackups.get.handler(async ({ context, input }) => {
    const { backup } = await requireBackupPermission(
      context.headers,
      input.backupId,
      "read"
    );
    return {
      data: toPublicBackup(backup, await requesterNamesOf([backup])),
    };
  }),
  list: os.databaseBackups.list.handler(async ({ context, input }) => {
    const { connection } = await requireConnectionPermission(
      context.headers,
      input.connectionId,
      "read"
    );
    const backups = await listBackups({
      connectionId: connection.id,
      organizationId: connection.organizationId,
    });
    const names = await requesterNamesOf(backups);
    return { data: backups.map((backup) => toPublicBackup(backup, names)) };
  }),
  listForOrganization: os.databaseBackups.listForOrganization.handler(
    async ({ context, input }) => {
      await requireOrganizationAccess(
        context.headers,
        input.organizationId,
        "databases",
        "read"
      );
      const backups = await listBackups({
        organizationId: input.organizationId,
      });
      const names = await requesterNamesOf(backups);
      return { data: backups.map((backup) => toPublicBackup(backup, names)) };
    }
  ),
  start: os.databaseBackups.start.handler(async ({ context, input }) => {
    const { connection, user } = await requireConnectionPermission(
      context.headers,
      input.connectionId,
      "backup"
    );
    const backup = await withDatabaseErrors(() =>
      startBackup(
        { actorId: user.id, scope: scopeOf(connection) },
        getJobProvider()
      )
    );
    return {
      data: toPublicBackup(backup, await requesterNamesOf([backup])),
    };
  }),
};
