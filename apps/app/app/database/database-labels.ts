import type { apiClient } from "@repo/api/client";

export type DatabaseConnection = Awaited<
  ReturnType<typeof apiClient.databaseConnections.list>
>["data"][number];

export type DatabaseBackup = Awaited<
  ReturnType<typeof apiClient.databaseBackups.list>
>["data"][number];

export type BackupStatus = DatabaseBackup["status"];

/** The connection's SSL mode as shown next to its port. */
export const sslLabel = (sslMode: string | null) => sslMode ?? "default";

export const ENGINE_LABELS: Record<DatabaseConnection["engine"], string> = {
  POSTGRESQL: "PostgreSQL",
};

/** Whether a backup can still change, and so is worth refreshing. */
export const isBackupActive = (status: BackupStatus) =>
  status === "QUEUED" || status === "RUNNING";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when a URL points at the machine the toolkit's API runs on. */
export const isLocalHostUrl = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
};

const SUPPORTED_SCHEMES = new Set(["postgresql:", "postgres:"]);
const URL_SCHEME = /^([a-z][a-z0-9+.-]*:)\/\//i;

/** The scheme of a URL the toolkit cannot use yet, for an early hint. */
export const unsupportedScheme = (url: string): string | null => {
  const match = URL_SCHEME.exec(url.trim());
  const scheme = match?.[1]?.toLowerCase();
  return scheme && !SUPPORTED_SCHEMES.has(scheme) ? scheme.slice(0, -1) : null;
};

export const backupDownloadPath = (backupId: string) =>
  `/api/databases/backups/${encodeURIComponent(backupId)}/download`;
