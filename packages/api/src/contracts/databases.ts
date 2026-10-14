import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";
import { organizationIdInput } from "./shopify-shared";

export const databaseEngineSchema = z.enum(["POSTGRESQL"]);

export const databaseBackupStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

/** Fields are listed explicitly; the connection URL is never returned. */
export const databaseConnectionSchema = z.object({
  createdAt: z.date(),
  databaseName: z.string(),
  engine: databaseEngineSchema,
  host: z.string(),
  id: z.string(),
  lastCheckError: z.string().nullable(),
  lastCheckedAt: z.date().nullable(),
  name: z.string(),
  organizationId: z.string(),
  port: z.number().int(),
  serverVersion: z.string().nullable(),
  updatedAt: z.date(),
  username: z.string(),
});

export const databaseBackupSchema = z.object({
  checksumSha256: z.string().nullable(),
  completedAt: z.date().nullable(),
  connectionId: z.string().nullable(),
  connectionName: z.string(),
  createdAt: z.date(),
  databaseName: z.string(),
  engine: databaseEngineSchema,
  error: z.string().nullable(),
  fileName: z.string().nullable(),
  id: z.string(),
  organizationId: z.string(),
  serverVersion: z.string().nullable(),
  /** Bytes, as a decimal string: archives can exceed what a JSON number holds exactly. */
  sizeBytes: z.string().nullable(),
  startedAt: z.date().nullable(),
  status: databaseBackupStatusSchema,
  toolVersion: z.string().nullable(),
});

const connectionIdInput = z.object({ connectionId: z.string().min(1) });
const backupIdInput = z.object({ backupId: z.string().min(1) });
const connectionName = z.string().trim().min(1).max(100);
const connectionUrl = z.string().trim().min(1).max(4096);

export const databaseConnectionsContract = {
  check: apiContract
    .route({
      method: "POST",
      operationId: "databaseConnections.check",
      path: "/api/databases/connections/{connectionId}/check",
      summary: "Connect to the database and record whether it worked",
    })
    .input(connectionIdInput)
    .output(dataEnvelope(databaseConnectionSchema)),
  create: apiContract
    .route({
      method: "POST",
      operationId: "databaseConnections.create",
      path: "/api/organizations/{organizationId}/databases/connections",
      successStatus: 201,
      summary: "Save a database connection after checking it",
    })
    .input(
      organizationIdInput.extend({ name: connectionName, url: connectionUrl })
    )
    .output(dataEnvelope(databaseConnectionSchema)),
  delete: apiContract
    .route({
      method: "DELETE",
      operationId: "databaseConnections.delete",
      path: "/api/databases/connections/{connectionId}",
      summary: "Delete a connection; its finished backups are kept",
    })
    .input(connectionIdInput)
    .output(dataEnvelope(z.object({ id: z.string() }))),
  get: apiContract
    .route({
      method: "GET",
      operationId: "databaseConnections.get",
      path: "/api/databases/connections/{connectionId}",
      summary: "Get a database connection",
    })
    .input(connectionIdInput)
    .output(dataEnvelope(databaseConnectionSchema)),
  list: apiContract
    .route({
      method: "GET",
      operationId: "databaseConnections.list",
      path: "/api/organizations/{organizationId}/databases/connections",
      summary: "List an organization's database connections",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(databaseConnectionSchema))),
  update: apiContract
    .route({
      method: "PATCH",
      operationId: "databaseConnections.update",
      path: "/api/databases/connections/{connectionId}",
      summary: "Rename a connection or replace its URL",
    })
    .input(
      connectionIdInput.extend({
        name: connectionName.optional(),
        url: connectionUrl.optional(),
      })
    )
    .output(dataEnvelope(databaseConnectionSchema)),
};

export const databaseBackupsContract = {
  delete: apiContract
    .route({
      method: "DELETE",
      operationId: "databaseBackups.delete",
      path: "/api/databases/backups/{backupId}",
      summary: "Delete a backup and its file",
    })
    .input(backupIdInput)
    .output(dataEnvelope(z.object({ id: z.string() }))),
  get: apiContract
    .route({
      method: "GET",
      operationId: "databaseBackups.get",
      path: "/api/databases/backups/{backupId}",
      summary: "Get a backup",
    })
    .input(backupIdInput)
    .output(dataEnvelope(databaseBackupSchema)),
  list: apiContract
    .route({
      method: "GET",
      operationId: "databaseBackups.list",
      path: "/api/databases/connections/{connectionId}/backups",
      summary: "List the latest backups of a connection",
    })
    .input(connectionIdInput)
    .output(dataEnvelope(z.array(databaseBackupSchema))),
  listForOrganization: apiContract
    .route({
      method: "GET",
      operationId: "databaseBackups.listForOrganization",
      path: "/api/organizations/{organizationId}/databases/backups",
      summary:
        "List an organization's latest backups, including those of deleted connections",
    })
    .input(organizationIdInput)
    .output(dataEnvelope(z.array(databaseBackupSchema))),
  start: apiContract
    .route({
      method: "POST",
      operationId: "databaseBackups.start",
      path: "/api/databases/connections/{connectionId}/backups",
      successStatus: 202,
      summary: "Start a backup in the background",
    })
    .input(connectionIdInput)
    .output(dataEnvelope(databaseBackupSchema)),
};
