import type { apiClient } from "@repo/api/client";

export type DatabaseConnection = Awaited<
  ReturnType<typeof apiClient.databaseConnections.list>
>["data"][number];

export type DatabaseBackup = Awaited<
  ReturnType<typeof apiClient.databaseBackups.list>
>["data"][number];

export type BackupStatus = DatabaseBackup["status"];

export const ENGINE_LABELS: Record<DatabaseConnection["engine"], string> = {
  POSTGRESQL: "PostgreSQL",
};

export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  COMPLETED: "Completed",
  FAILED: "Failed",
  QUEUED: "Queued",
  RUNNING: "Running",
};

export const BACKUP_STATUS_VARIANTS: Record<
  BackupStatus,
  "default" | "destructive" | "outline" | "secondary"
> = {
  COMPLETED: "default",
  FAILED: "destructive",
  QUEUED: "secondary",
  RUNNING: "secondary",
};

/** Whether a backup can still change, and so is worth refreshing. */
export const isBackupActive = (status: BackupStatus) =>
  status === "QUEUED" || status === "RUNNING";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** "48.2 MB" from a byte count sent as a decimal string. */
export const formatBytes = (value: string | null): string => {
  if (value === null) {
    return "—";
  }
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${BYTE_UNITS[unit]}`;
};

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
