"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  cn,
  Download,
  StatusBadge,
  Trash2,
  toast,
} from "@repo/design-system";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useEffect, useState } from "react";
import { formatBytes, formatDuration, formatWhen } from "../lib/format";
import {
  backupDownloadPath,
  type DatabaseBackup,
  isBackupActive,
} from "./database-labels";

/** Re-renders every second while something on screen is still running. */
const useTick = (active: boolean) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
};

const StatusCell = ({ backup }: { backup: DatabaseBackup }) => {
  const active = isBackupActive(backup.status);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <StatusBadge status={backup.status} />
      {active ? (
        <div className="flex w-full max-w-[260px] items-center gap-2">
          <div className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-border">
            <div className="absolute inset-y-0 w-2/5 animate-[wz-indeterminate_1s_ease-in-out_infinite] rounded-full bg-(--status-info-dot)" />
          </div>
          <span className="font-medium font-mono text-[11.5px] text-muted-foreground">
            {backup.status === "QUEUED"
              ? "waiting"
              : formatDuration(backup.startedAt ?? backup.createdAt)}
          </span>
        </div>
      ) : null}
      {backup.status === "FAILED" ? (
        <span className="whitespace-normal text-(--status-danger-fg) text-xs leading-[1.35]">
          {backup.error ?? "No reason was recorded."}
        </span>
      ) : null}
      {backup.status === "COMPLETED" ? (
        <span className="text-muted-foreground text-xs leading-[1.35]">
          pg_dump {backup.toolVersion ?? ""} · custom format
        </span>
      ) : null}
    </div>
  );
};

const DeleteBackup = ({
  backup,
  onDeleted,
}: {
  backup: DatabaseBackup;
  onDeleted: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const remove = async () => {
    setIsWorking(true);
    try {
      await apiClient.databaseBackups.delete({ backupId: backup.id });
      toast.success("Backup deleted", {
        description: formatWhen(backup.createdAt),
      });
      setOpen(false);
      onDeleted();
    } catch (cause) {
      toast.error("Could not delete the backup", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsWorking(false);
    }
  };
  return (
    <>
      <Button
        aria-label="Delete backup"
        className="text-muted-foreground hover:bg-(--alert-danger-bg) hover:text-(--status-danger-fg)"
        onClick={() => setOpen(true)}
        size="icon-sm"
        title="Delete backup"
        variant="ghost"
      >
        <Trash2 className="size-[15px]" />
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The file from {formatWhen(backup.createdAt)} is removed from
              storage. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={isWorking} onClick={remove} variant="danger">
              {isWorking ? "Deleting…" : "Delete backup"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

/** A backup history, with download and delete for those allowed to. */
export function BackupsTable({
  backups,
  canBackup,
  freshId,
  onChanged,
}: {
  backups: DatabaseBackup[];
  canBackup: boolean;
  /** A backup that just finished, highlighted for a moment. */
  freshId: string | null;
  onChanged: () => void;
}) {
  useTick(backups.some((backup) => isBackupActive(backup.status)));
  return (
    <Table className="min-w-[820px] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[206px]">Started</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[116px]">Size</TableHead>
          <TableHead className="w-[116px]">Duration</TableHead>
          <TableHead className="w-[176px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {backups.map((backup) => {
          const active = isBackupActive(backup.status);
          return (
            <TableRow
              className={cn(
                "transition-colors duration-700",
                backup.id === freshId && "bg-[#f3faf5] hover:bg-[#f3faf5]",
                active && "bg-[#f6f9fe] hover:bg-[#f6f9fe]"
              )}
              data-testid={`database-backup-${backup.id}`}
              key={backup.id}
            >
              <TableCell className="h-[62px]">
                <div className="font-medium text-[13px] text-foreground">
                  {formatWhen(backup.startedAt ?? backup.createdAt)}
                </div>
                <div className="text-muted-foreground text-xs leading-[1.4]">
                  by {backup.requestedByName ?? "someone"}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                <StatusCell backup={backup} />
              </TableCell>
              <TableCell className="font-mono text-[12.5px]">
                {formatBytes(backup.sizeBytes)}
              </TableCell>
              <TableCell className="font-mono text-[12.5px]">
                {backup.startedAt && !active
                  ? formatDuration(backup.startedAt, backup.completedAt)
                  : "—"}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1.5">
                  {canBackup &&
                  backup.status === "COMPLETED" &&
                  backup.fileName ? (
                    <a
                      className={buttonVariants({
                        size: "sm",
                        variant: "outline",
                      })}
                      download
                      href={backupDownloadPath(backup.id)}
                    >
                      <Download />
                      Download
                    </a>
                  ) : null}
                  {canBackup && !active ? (
                    <DeleteBackup backup={backup} onDeleted={onChanged} />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
