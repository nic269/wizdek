import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { prisma } from "@repo/database";
import type { JobDefinition } from "@repo/jobs";
import { logger } from "@repo/logger";
import {
  buildTenantObjectKey,
  getStorageProvider,
  type StorageProvider,
  type StoredObject,
  sanitizeObjectKeySegment,
} from "@repo/storage";
import { openConnection } from "../connections/connections";
import { adapterForEngine } from "../engines";
import type { DatabaseEngine, DatabaseEngineAdapter } from "../engines/types";
import { DatabaseToolsError } from "../errors";
import { backupTempDirectory } from "../keys";
import { redactSecrets } from "../redact";
import { DATABASE_BACKUP_JOB, type DatabaseBackupJobPayload } from "./backups";

/** Longest a single backup may run before it is stopped and marked failed. */
export const BACKUP_TIMEOUT_SECONDS = 12 * 60 * 60;
const MAX_ERROR_LENGTH = 2000;
const FILE_TIMESTAMP_SEPARATORS = /[:.]/g;
// Leaves room for the timestamp and extension within a storage key segment.
const MAX_NAME_IN_FILE = 60;

export interface BackupJobDependencies {
  adapterFor?: (engine: DatabaseEngine) => DatabaseEngineAdapter;
  storage?: () => StorageProvider;
  tempDirectory?: () => string;
}

const STOPPED_MESSAGE =
  "The backup was stopped before it finished, because the API shut down or the backup ran longer than allowed. Start it again.";

const describe = (error: unknown, signal: AbortSignal) => {
  if (
    signal.aborted ||
    (error instanceof DatabaseToolsError && error.failure === "ABORTED")
  ) {
    return STOPPED_MESSAGE;
  }
  return error instanceof Error ? error.message : "The backup failed.";
};

/** e.g. "EVISU-production-2026-10-14T03-21-38-000Z.dump", safe as a file name. */
const fileNameFor = (connectionName: string, extension: string, at: Date) =>
  `${sanitizeObjectKeySegment(connectionName).slice(0, MAX_NAME_IN_FILE)}-${at
    .toISOString()
    .replace(FILE_TIMESTAMP_SEPARATORS, "-")}.${extension}`;

const markFailed = (backupId: string, message: string) =>
  prisma.databaseBackup.update({
    data: {
      completedAt: new Date(),
      error: message.slice(0, MAX_ERROR_LENGTH),
      status: "FAILED",
    },
    where: { id: backupId },
  });

/** Streams a file into storage while computing its SHA-256. */
const uploadFile = async (input: {
  contentType: string;
  key: string;
  path: string;
  signal: AbortSignal;
  storage: StorageProvider;
}): Promise<{ checksum: string; stored: StoredObject }> => {
  const hash = createHash("sha256");
  const source = createReadStream(input.path);
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const stop = () =>
    source.destroy(
      new DatabaseToolsError("ABORTED", "The upload was stopped.")
    );
  input.signal.addEventListener("abort", stop, { once: true });
  source.once("error", (error) => hasher.destroy(error));
  try {
    const stored = await input.storage.putObjectStream({
      body: source.pipe(hasher),
      contentType: input.contentType,
      key: input.key,
    });
    return { checksum: hash.digest("hex"), stored };
  } finally {
    input.signal.removeEventListener("abort", stop);
  }
};

/**
 * Dumps the database to a temporary file, proves the file is a readable
 * backup, then uploads it. A failure at any step leaves nothing in storage
 * and no temporary file, and marks the backup failed with a reason that
 * contains no credentials.
 */
export const runBackup = async (
  backupId: string,
  signal: AbortSignal,
  deps: BackupJobDependencies = {}
): Promise<void> => {
  const backup = await prisma.databaseBackup.findUnique({
    include: { connection: true },
    where: { id: backupId },
  });
  // A second delivery of a finished backup has nothing left to do.
  if (!backup || backup.status === "COMPLETED" || backup.status === "FAILED") {
    return;
  }
  if (!backup.connection) {
    await markFailed(
      backupId,
      "The connection was deleted before the backup ran."
    );
    return;
  }

  const startedAt = new Date();
  await prisma.databaseBackup.update({
    data: { error: null, startedAt, status: "RUNNING" },
    where: { id: backupId },
  });

  let secrets: string[] = [];
  let storage: StorageProvider | undefined;
  let stored: StoredObject | undefined;
  let tempPath: string | undefined;

  try {
    const adapter = (deps.adapterFor ?? adapterForEngine)(backup.engine);
    storage = (deps.storage ?? getStorageProvider)();
    const directory = (deps.tempDirectory ?? backupTempDirectory)();
    tempPath = join(directory, `${backup.id}.${adapter.fileExtension}`);
    const opened = openConnection(backup.connection);
    ({ secrets } = opened);
    const tool = await adapter.toolVersion(signal);
    const server = await adapter.check(opened.target);
    if (tool.major < server.major) {
      throw new DatabaseToolsError(
        "TOOL_TOO_OLD",
        `${tool.text} cannot back up a ${adapter.label} ${server.text} server. Install ${adapter.label} client ${server.major} or newer.`
      );
    }

    await mkdir(directory, { recursive: true });
    await adapter.dump({ outputPath: tempPath, signal, target: opened.target });
    await adapter.verify({ path: tempPath, signal });

    const fileName = fileNameFor(
      backup.connectionName,
      adapter.fileExtension,
      startedAt
    );
    const upload = await uploadFile({
      contentType: adapter.contentType,
      key: buildTenantObjectKey({
        fileName,
        organizationId: backup.organizationId,
      }),
      path: tempPath,
      signal,
      storage,
    });
    ({ stored } = upload);
    if (signal.aborted) {
      throw new DatabaseToolsError("ABORTED", "The backup was stopped.");
    }

    await prisma.databaseBackup.update({
      data: {
        checksumSha256: upload.checksum,
        completedAt: new Date(),
        fileName,
        objectKey: stored.key,
        serverVersion: server.text,
        sizeBytes: BigInt(stored.sizeBytes),
        status: "COMPLETED",
        storageProvider: stored.provider,
        toolVersion: tool.text,
      },
      where: { id: backupId },
    });
  } catch (error) {
    if (storage && stored) {
      await storage.deleteObject({ key: stored.key }).catch(() => undefined);
    }
    const message = redactSecrets(describe(error, signal), secrets);
    logger.warn("database.backup.failed", {
      backupId,
      organizationId: backup.organizationId,
      reason: message,
    });
    await markFailed(backupId, message);
  } finally {
    if (tempPath) {
      await rm(tempPath, { force: true });
    }
  }
};

/**
 * The background job behind a backup. A process that dies mid-backup gets
 * one more attempt, which starts the dump over; a backup that fails for a
 * reason of its own is recorded as failed and not retried.
 */
export const createDatabaseBackupJob = (
  deps: BackupJobDependencies = {}
): JobDefinition<DatabaseBackupJobPayload> => ({
  handler: ({ backupId }, { signal }) => runBackup(backupId, signal, deps),
  heartbeatSeconds: 60,
  name: DATABASE_BACKUP_JOB,
  retry: { attempts: 2, delayMs: 5000 },
  serialPerKey: true,
  timeoutSeconds: BACKUP_TIMEOUT_SECONDS,
});
