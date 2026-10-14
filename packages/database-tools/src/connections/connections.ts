import { type Prisma, prisma } from "@repo/database";
import { decryptSecret, encryptSecret } from "@repo/security/crypto";
import { recordDatabaseAudit } from "../audit";
import { adapterForEngine, resolveAdapter } from "../engines";
import type { DatabaseEngineAdapter, DatabaseTarget } from "../engines/types";
import { DatabaseToolsError } from "../errors";
import { redactSecrets, secretsOf } from "../redact";

export type DatabaseConnectionRecord =
  Prisma.DatabaseConnectionGetPayload<object>;

export interface ConnectionScope {
  connectionId: string;
  organizationId: string;
}

const MAX_ERROR_LENGTH = 2000;
const ACTIVE_BACKUP_STATUSES = ["QUEUED", "RUNNING"] as const;

const notFound = () =>
  new DatabaseToolsError(
    "CONNECTION_NOT_FOUND",
    "Database connection not found."
  );

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

const normalizeName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new DatabaseToolsError("INVALID_NAME", "Give the connection a name.");
  }
  return trimmed;
};

/** Parses and checks a URL; the URL itself is never kept outside `encrypted`. */
const inspectUrl = async (url: string) => {
  const adapter = resolveAdapter(url);
  const target = adapter.parseUrl(url);
  const server = await adapter.check(target);
  return {
    adapter,
    columns: {
      databaseName: target.databaseName,
      engine: adapter.engine,
      host: target.host,
      lastCheckError: null,
      lastCheckedAt: new Date(),
      port: target.port,
      serverVersion: server.text,
      urlEncrypted: encryptSecret(url.trim()),
      username: target.username,
    },
  };
};

const auditMetadata = (connection: DatabaseConnectionRecord) => ({
  databaseName: connection.databaseName,
  engine: connection.engine,
  host: connection.host,
  name: connection.name,
});

export const listConnections = (
  organizationId: string
): Promise<DatabaseConnectionRecord[]> =>
  prisma.databaseConnection.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    where: { organizationId },
  });

/** Unscoped lookup, for deciding which organization a connection belongs to. */
export const findConnectionById = (
  connectionId: string
): Promise<DatabaseConnectionRecord | null> =>
  prisma.databaseConnection.findUnique({ where: { id: connectionId } });

export const getConnection = async ({
  connectionId,
  organizationId,
}: ConnectionScope): Promise<DatabaseConnectionRecord> => {
  const connection = await prisma.databaseConnection.findFirst({
    where: { id: connectionId, organizationId },
  });
  if (!connection) {
    throw notFound();
  }
  return connection;
};

/** Decrypts a connection for a tool to use. Callers must not persist it. */
export const openConnection = (
  connection: DatabaseConnectionRecord
): {
  adapter: DatabaseEngineAdapter;
  secrets: string[];
  target: DatabaseTarget;
} => {
  const adapter = adapterForEngine(connection.engine);
  const url = decryptSecret(connection.urlEncrypted);
  const target = adapter.parseUrl(url);
  return { adapter, secrets: secretsOf(url, target.password), target };
};

/** Saves a connection after proving it can be reached. */
export const createConnection = async (input: {
  actorId: string;
  name: string;
  organizationId: string;
  url: string;
}): Promise<DatabaseConnectionRecord> => {
  const name = normalizeName(input.name);
  const { columns } = await inspectUrl(input.url);
  try {
    return await prisma.$transaction(async (db) => {
      const connection = await db.databaseConnection.create({
        data: {
          ...columns,
          createdById: input.actorId,
          name,
          organizationId: input.organizationId,
        },
      });
      await recordDatabaseAudit(db, {
        action: "database.connection.created",
        actorId: input.actorId,
        metadata: auditMetadata(connection),
        organizationId: connection.organizationId,
        targetId: connection.id,
        targetType: "DatabaseConnection",
      });
      return connection;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DatabaseToolsError(
        "NAME_TAKEN",
        `A connection named "${name}" already exists.`
      );
    }
    throw error;
  }
};

/** Renames a connection, replaces its URL, or both. A new URL is checked first. */
export const updateConnection = async (input: {
  actorId: string;
  name?: string;
  scope: ConnectionScope;
  url?: string;
}): Promise<DatabaseConnectionRecord> => {
  const existing = await getConnection(input.scope);
  const name =
    input.name === undefined ? existing.name : normalizeName(input.name);
  const columns = input.url ? (await inspectUrl(input.url)).columns : {};
  try {
    return await prisma.$transaction(async (db) => {
      const connection = await db.databaseConnection.update({
        data: { ...columns, name },
        where: { id: existing.id },
      });
      await recordDatabaseAudit(db, {
        action: "database.connection.updated",
        actorId: input.actorId,
        metadata: {
          ...auditMetadata(connection),
          renamed: name !== existing.name,
          urlReplaced: Boolean(input.url),
        },
        organizationId: connection.organizationId,
        targetId: connection.id,
        targetType: "DatabaseConnection",
      });
      return connection;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DatabaseToolsError(
        "NAME_TAKEN",
        `A connection named "${name}" already exists.`
      );
    }
    throw error;
  }
};

/**
 * Connects to the database and records the outcome on the connection. An
 * unreachable database is a result, not an error.
 */
export const checkConnection = async (
  scope: ConnectionScope
): Promise<DatabaseConnectionRecord> => {
  const connection = await getConnection(scope);
  const { adapter, secrets, target } = openConnection(connection);
  try {
    const server = await adapter.check(target);
    return await prisma.databaseConnection.update({
      data: {
        lastCheckError: null,
        lastCheckedAt: new Date(),
        serverVersion: server.text,
      },
      where: { id: connection.id },
    });
  } catch (error) {
    const message = redactSecrets(
      error instanceof Error ? error.message : "The check failed.",
      secrets
    ).slice(0, MAX_ERROR_LENGTH);
    return prisma.databaseConnection.update({
      data: { lastCheckError: message, lastCheckedAt: new Date() },
      where: { id: connection.id },
    });
  }
};

/** Deletes a connection. Its finished backups, and their files, are kept. */
export const deleteConnection = async (input: {
  actorId: string;
  scope: ConnectionScope;
}): Promise<void> => {
  await prisma.$transaction(async (db) => {
    const connection = await db.databaseConnection.findFirst({
      where: {
        id: input.scope.connectionId,
        organizationId: input.scope.organizationId,
      },
    });
    if (!connection) {
      throw notFound();
    }
    const active = await db.databaseBackup.count({
      where: {
        connectionId: connection.id,
        status: { in: [...ACTIVE_BACKUP_STATUSES] },
      },
    });
    if (active > 0) {
      throw new DatabaseToolsError(
        "CONNECTION_BUSY",
        "A backup of this connection is still running. Wait for it to finish, then delete the connection."
      );
    }
    await db.databaseConnection.delete({ where: { id: connection.id } });
    await recordDatabaseAudit(db, {
      action: "database.connection.deleted",
      actorId: input.actorId,
      metadata: auditMetadata(connection),
      organizationId: connection.organizationId,
      targetId: connection.id,
      targetType: "DatabaseConnection",
    });
  });
};
