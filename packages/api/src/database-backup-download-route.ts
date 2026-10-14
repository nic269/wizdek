import { Readable } from "node:stream";
import {
  getDownloadableBackup,
  recordBackupDownload,
} from "@repo/database-tools";
import { getStorageProvider } from "@repo/storage";
import type { Context } from "hono";
import { requireBackupPermission } from "./routers/authz";
import { withDatabaseErrors } from "./routers/database-errors";

export const DATABASE_BACKUP_DOWNLOAD_PATH =
  "/api/databases/backups/:backupId/download";

const SIGNED_URL_SECONDS = 60;
const UNSAFE_FILE_NAME_CHARACTERS = /[^a-zA-Z0-9._-]/g;

/**
 * Serves a backup archive. The permission is checked on every request; when
 * storage can sign a short-lived link the browser is sent there, otherwise
 * the file is streamed through without being held in memory.
 */
export const handleDatabaseBackupDownload = async (context: Context) => {
  const { backup, user } = await requireBackupPermission(
    context.req.raw.headers,
    context.req.param("backupId") ?? "",
    "backup"
  );
  const downloadable = await withDatabaseErrors(() =>
    getDownloadableBackup({
      backupId: backup.id,
      organizationId: backup.organizationId,
    })
  );
  const storage = getStorageProvider();
  await recordBackupDownload({ actorId: user.id, backup: downloadable });

  if (storage.getSignedDownloadUrl) {
    const { url } = await storage.getSignedDownloadUrl({
      expiresInSeconds: SIGNED_URL_SECONDS,
      key: downloadable.objectKey,
    });
    return context.redirect(url, 302);
  }

  const object = await storage.getObjectStream({
    key: downloadable.objectKey,
  });
  // A client that disconnects cancels the web stream, which closes the file.
  const body = Readable.toWeb(object.body) as ReadableStream<Uint8Array>;
  const fileName = downloadable.fileName.replace(
    UNSAFE_FILE_NAME_CHARACTERS,
    "_"
  );
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(object.sizeBytes),
      "content-type": "application/octet-stream",
    },
    status: 200,
  });
};
