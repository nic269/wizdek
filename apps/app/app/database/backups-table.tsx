"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, buttonVariants, ErrorState } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useState } from "react";
import { formatDateTime, formatDuration } from "../flows/flow-labels";
import {
  BACKUP_STATUS_LABELS,
  BACKUP_STATUS_VARIANTS,
  backupDownloadPath,
  type DatabaseBackup,
  formatBytes,
  isBackupActive,
} from "./database-labels";

/** A backup history, with download and delete for those allowed to. */
export function BackupsTable({
  backups,
  canBackup,
  onChanged,
  showConnection = false,
}: {
  backups: DatabaseBackup[];
  canBackup: boolean;
  onChanged: () => void;
  showConnection?: boolean;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (backupId: string) => {
    setError(null);
    setBusyId(backupId);
    try {
      await apiClient.databaseBackups.delete({ backupId });
      onChanged();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not delete the backup."));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {error ? <ErrorState message={error} /> : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {showConnection ? <TableHead>Connection</TableHead> : null}
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.map((backup) => (
              <TableRow
                data-testid={`database-backup-${backup.id}`}
                key={backup.id}
              >
                {showConnection ? (
                  <TableCell>
                    <div className="font-medium">{backup.connectionName}</div>
                    <div className="text-muted-foreground text-xs">
                      {backup.databaseName}
                    </div>
                  </TableCell>
                ) : null}
                <TableCell>{formatDateTime(backup.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant={BACKUP_STATUS_VARIANTS[backup.status]}>
                    {BACKUP_STATUS_LABELS[backup.status]}
                  </Badge>
                  {backup.error ? (
                    <p className="mt-1 max-w-sm whitespace-normal text-destructive text-xs">
                      {backup.error}
                    </p>
                  ) : null}
                  {backup.toolVersion ? (
                    <p
                      className="mt-1 max-w-sm truncate text-muted-foreground text-xs"
                      title={`${backup.toolVersion} · server ${backup.serverVersion ?? "unknown"}`}
                    >
                      {backup.toolVersion}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>{formatBytes(backup.sizeBytes)}</TableCell>
                <TableCell>
                  {formatDuration(backup.startedAt, backup.completedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {confirmingId === backup.id ? (
                      <>
                        <Button
                          disabled={busyId === backup.id}
                          onClick={() => remove(backup.id)}
                          size="sm"
                          variant="destructive"
                        >
                          Confirm delete
                        </Button>
                        <Button
                          onClick={() => setConfirmingId(null)}
                          size="sm"
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {canBackup && backup.status === "COMPLETED" ? (
                          <a
                            className={buttonVariants({
                              size: "sm",
                              variant: "outline",
                            })}
                            download
                            href={backupDownloadPath(backup.id)}
                          >
                            Download
                          </a>
                        ) : null}
                        {canBackup && !isBackupActive(backup.status) ? (
                          <Button
                            onClick={() => setConfirmingId(backup.id)}
                            size="sm"
                            variant="ghost"
                          >
                            Delete
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
