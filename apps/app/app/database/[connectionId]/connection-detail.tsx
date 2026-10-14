"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Activity,
  Button,
  EmptyState,
  type Environment,
  EnvTag,
  ErrorAlert,
  HardDrive,
  HardDriveDownload,
  Input,
  LoaderCircle,
  PageHeader,
  PencilLine,
  RefreshCw,
  SegmentedControl,
  ShieldCheck,
  Shimmer,
  SkeletonRows,
  StatusBadge,
  TriangleAlert,
  toast,
} from "@repo/design-system";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/ui/alert-dialog";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { BackLink } from "../../lib/back-link";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  plural,
} from "../../lib/format";
import { ENVIRONMENT_OPTIONS } from "../../stores/store-drawer";
import { BackupsTable } from "../backups-table";
import { ConnectionUrlField } from "../connection-url-field";
import { DatabaseChip } from "../connections-panel";
import {
  type DatabaseBackup,
  type DatabaseConnection,
  ENGINE_LABELS,
  isBackupActive,
  sslLabel,
} from "../database-labels";

const REFRESH_INTERVAL_MS = 3000;
const FRESH_HIGHLIGHT_MS = 4000;
const ENVIRONMENT_WORDS = {
  DEV: "development",
  PROD: "production",
  STAGING: "staging",
} as const;

const connectionKey = (connectionId: string) => [
  "database-connection",
  connectionId,
];
const backupsKey = (connectionId: string) => [
  "database-connection-backups",
  connectionId,
];

const useConnectionBackups = (connectionId: string) =>
  useQuery({
    queryFn: () => apiClient.databaseBackups.list({ connectionId }),
    queryKey: backupsKey(connectionId),
    // Keeps refreshing only while a backup can still change.
    refetchInterval: (query) =>
      query.state.data?.data.some((backup) => isBackupActive(backup.status))
        ? REFRESH_INTERVAL_MS
        : false,
  });

/**
 * Says so when a backup that was running on this page finishes, and marks
 * its row for a moment. Long work keeps going if the page is left.
 */
const useBackupCompletion = (
  connection: DatabaseConnection | undefined,
  backups: DatabaseBackup[]
) => {
  const previous = useRef(new Map<string, string>());
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(() => {
    for (const backup of backups) {
      const before = previous.current.get(backup.id);
      if (before && isBackupActive(before as DatabaseBackup["status"])) {
        if (backup.status === "COMPLETED") {
          toast.success("Backup completed", {
            description: `${connection?.name ?? "Database"} · ${formatBytes(backup.sizeBytes)} · ready to download`,
          });
          setFreshId(backup.id);
          window.setTimeout(() => setFreshId(null), FRESH_HIGHLIGHT_MS);
        }
        if (backup.status === "FAILED") {
          toast.error("Backup failed", {
            description: backup.error ?? undefined,
          });
        }
      }
    }
    previous.current = new Map(
      backups.map((backup) => [backup.id, backup.status])
    );
  }, [backups, connection?.name]);
  return freshId;
};

/** Rename the connection, change its environment, or replace its URL. */
function EditConnectionForm({
  connection,
  onDone,
}: {
  connection: DatabaseConnection;
  onDone: (updated: DatabaseConnection | null) => void;
}) {
  const [name, setName] = useState(connection.name);
  const [url, setUrl] = useState("");
  const [environment, setEnvironment] = useState<Environment>(
    connection.environment
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.databaseConnections.update({
        connectionId: connection.id,
        environment,
        name,
        ...(url.trim() ? { url } : {}),
      });
      toast.success("Connection updated", {
        description: url.trim() ? "Tested successfully before saving." : name,
      });
      onDone(data);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the connection."));
      setIsSaving(false);
    }
  };

  return (
    <form
      className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-start gap-4 rounded-card border border-border p-[18px]"
      onSubmit={submit}
    >
      {error ? (
        <ErrorAlert
          className="col-span-full"
          message={error}
          title="Not saved."
        />
      ) : null}
      <Field className="gap-1.5">
        <FieldLabel htmlFor="edit-connection-name">Name</FieldLabel>
        <Input
          id="edit-connection-name"
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </Field>
      <ConnectionUrlField
        hint="Leave blank to keep the current URL. A new URL is tested before it's saved."
        label="Database URL · leave blank to keep current"
        onChange={setUrl}
        placeholder="postgres://user:••••@host:5432/db"
        required={false}
        value={url}
      />
      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-[13px]">Environment</span>
        <SegmentedControl
          aria-label="Environment"
          className="self-start"
          onValueChange={setEnvironment}
          options={ENVIRONMENT_OPTIONS}
          value={environment}
        />
      </div>
      <div className="col-span-full flex gap-2">
        <Button onClick={() => onDone(null)} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={isSaving} type="submit">
          {isSaving ? <LoaderCircle className="animate-spin" /> : null}
          {isSaving ? "Testing…" : "Test & save"}
        </Button>
      </div>
    </form>
  );
}

const FactsStrip = ({
  connection,
  onChecked,
}: {
  connection: DatabaseConnection;
  onChecked: (connection: DatabaseConnection) => void;
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const check = async () => {
    setIsChecking(true);
    try {
      const { data } = await apiClient.databaseConnections.check({
        connectionId: connection.id,
      });
      onChecked(data);
      if (data.lastCheckError) {
        toast.error("Connection failed", { description: data.lastCheckError });
      } else {
        toast.success("Connection OK", {
          description: `${data.databaseName} is reachable`,
        });
      }
    } catch (cause) {
      toast.error("Could not check the connection", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsChecking(false);
    }
  };
  const facts = [
    ["Host", connection.host],
    ["Database", connection.databaseName],
    ["User", connection.username],
    [
      "Server version",
      `${ENGINE_LABELS[connection.engine]} ${connection.serverVersion ?? ""}`.trim(),
    ],
    ["Port · SSL", `${connection.port} · ${sslLabel(connection.sslMode)}`],
  ];
  return (
    <section className="overflow-hidden rounded-card border border-border">
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-px bg-border">
        {facts.map(([label, value]) => (
          <div className="min-w-0 bg-card px-4 py-3.5" key={label}>
            <dt className="mb-2 text-muted-foreground text-xs leading-none">
              {label}
            </dt>
            <dd
              className="truncate font-medium font-mono text-[13.5px] leading-[1.3]"
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2.5 border-border border-t bg-sunken px-4 py-2.5">
        <Activity className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-[12.5px] text-muted-foreground leading-[1.4]">
          {isChecking
            ? "Checking connection…"
            : `Last checked ${formatDateTime(connection.lastCheckedAt)}`}
          {connection.lastCheckError && !isChecking ? (
            <span className="block text-(--status-danger-fg)">
              {connection.lastCheckError}
            </span>
          ) : null}
        </span>
        <Button
          disabled={isChecking}
          onClick={check}
          size="xs"
          variant="outline"
        >
          {isChecking ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          Check connection
        </Button>
      </div>
    </section>
  );
};

const BackupConfirm = ({
  connection,
  lastCompleted,
  onConfirm,
  onOpenChange,
  open,
  starting,
}: {
  connection: DatabaseConnection;
  lastCompleted: DatabaseBackup | undefined;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  starting: boolean;
}) => {
  const prod = connection.environment === "PROD";
  const expectation =
    lastCompleted?.startedAt && lastCompleted.completedAt
      ? ` — the last backup took ${formatDuration(lastCompleted.startedAt, lastCompleted.completedAt)} for ${formatBytes(lastCompleted.sizeBytes)}`
      : "";
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader className="border-b-0 pb-0">
          <AlertDialogTitle>Back up {connection.name} now?</AlertDialogTitle>
          <AlertDialogDescription className="text-[13.5px]">
            Runs <span className="font-mono text-foreground-2">pg_dump</span>{" "}
            against the {ENVIRONMENT_WORDS[connection.environment]} database.
            Read-only, but it adds load{expectation}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogBody className="pt-3">
          <div className="flex items-center gap-2.5 rounded-menu border border-border bg-sunken px-3 py-2.5">
            <DatabaseChip size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono font-semibold text-[13px] leading-[1.3]">
                {connection.databaseName}
              </span>
              <span className="block truncate font-mono text-[11.5px] text-muted-foreground leading-[1.3]">
                {connection.host}
              </span>
            </span>
            <EnvTag environment={connection.environment} />
          </div>
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground leading-[1.4]">
            {prod ? (
              <TriangleAlert className="size-3.5" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            {prod
              ? "The file contains production data. Download only to trusted machines."
              : "The file contains all of this database's data."}
          </p>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button disabled={starting} onClick={onConfirm}>
            {starting ? "Starting…" : "Start backup"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const DangerZone = ({
  connection,
  disabledReason,
}: {
  connection: DatabaseConnection;
  disabledReason: string | null;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const remove = async () => {
    setIsWorking(true);
    try {
      await apiClient.databaseConnections.delete({
        connectionId: connection.id,
      });
      toast.success("Connection deleted", { description: connection.name });
      router.push("/database");
    } catch (cause) {
      toast.error("Could not delete the connection", {
        description: getApiErrorMessage(cause, "Try again."),
      });
      setIsWorking(false);
    }
  };
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-card border border-(--alert-danger-border) px-4 py-3.5">
      <div className="min-w-[240px] flex-1">
        <h2 className="font-semibold text-(--status-danger-fg) text-sm leading-[1.3]">
          Delete connection
        </h2>
        <p className="text-[13px] text-muted-foreground leading-normal">
          Removes the stored URL. Finished backups are kept and stay listed
          until you delete them.
        </p>
        {disabledReason ? (
          <p className="text-muted-foreground text-xs">{disabledReason}</p>
        ) : null}
      </div>
      <Button
        disabled={disabledReason !== null}
        onClick={() => setOpen(true)}
        size="sm"
        variant="destructive"
      >
        Delete connection…
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its saved URL is removed. Finished backups are kept and stay
              listed until you delete them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={isWorking} onClick={remove} variant="danger">
              {isWorking ? "Deleting…" : "Delete connection"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

const BackupsSection = ({
  backups,
  canBackup,
  freshId,
  onChanged,
}: {
  backups: ReturnType<typeof useConnectionBackups>;
  canBackup: boolean;
  freshId: string | null;
  onChanged: () => void;
}) => {
  const history = backups.data?.data ?? [];
  const completed = history.filter(({ status }) => status === "COMPLETED");
  const stored = completed.reduce(
    (sum, backup) => sum + Number(backup.sizeBytes ?? 0),
    0
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <h2 className="font-semibold text-base leading-[1.3]">Backups</h2>
          <p className="text-[13px] text-muted-foreground leading-normal">
            Full copies in PostgreSQL custom format, restorable with{" "}
            <span className="font-mono text-[12.5px]">pg_restore</span>. Files
            are kept until you delete them.
          </p>
        </div>
        {completed.length > 0 ? (
          <span className="text-[12.5px] text-muted-foreground">
            {plural(completed.length, "file")} · {formatBytes(stored)} stored
          </span>
        ) : null}
      </div>
      {backups.isError ? (
        <ErrorAlert
          message={getApiErrorMessage(backups.error, "Could not load backups.")}
          onRetry={() => backups.refetch()}
          title="Couldn't load backups."
        />
      ) : null}
      {backups.isPending ? (
        <div className="rounded-card border border-border">
          <SkeletonRows
            columns="190px minmax(220px,1fr) 100px 100px 190px"
            count={3}
            label="Loading backups"
          />
        </div>
      ) : null}
      {backups.data && history.length === 0 ? (
        <EmptyState
          description={
            canBackup
              ? "Choose Back up now to take the first one."
              : "No backup has been taken yet."
          }
          icon={<HardDrive />}
          title="No backups"
        />
      ) : null}
      {history.length > 0 ? (
        <BackupsTable
          backups={history}
          canBackup={canBackup}
          freshId={freshId}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
};

export function ConnectionDetail({
  canBackup,
  canManage,
  connectionId,
}: {
  canBackup: boolean;
  canManage: boolean;
  connectionId: string;
}) {
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryFn: () => apiClient.databaseConnections.get({ connectionId }),
    queryKey: connectionKey(connectionId),
  });
  const backups = useConnectionBackups(connectionId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const current = connection.data?.data;
  const history = backups.data?.data ?? [];
  const active = history.find((backup) => isBackupActive(backup.status));
  const freshId = useBackupCompletion(current, history);

  if (connection.isError) {
    return (
      <ErrorAlert
        message={getApiErrorMessage(
          connection.error,
          "Could not load the connection."
        )}
        onRetry={() => connection.refetch()}
        title="Couldn't load the connection."
      />
    );
  }
  if (!current) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <span className="sr-only">Loading connection</span>
        <Shimmer className="h-8 w-64" />
        <Shimmer className="h-24 w-full" />
      </div>
    );
  }

  const setConnection = (updated: DatabaseConnection) =>
    queryClient.setQueryData(connectionKey(connectionId), { data: updated });

  const startBackup = async () => {
    setStarting(true);
    try {
      await apiClient.databaseBackups.start({ connectionId });
      toast.loading("Backup started", {
        description: "You can leave this page — it keeps running.",
        duration: 4000,
      });
      setConfirming(false);
      await backups.refetch();
    } catch (cause) {
      toast.error("Could not start the backup", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <PageHeader
        actions={
          <>
            {canManage ? (
              <Button
                onClick={() => setEditing((value) => !value)}
                variant="outline"
              >
                <PencilLine />
                Edit
              </Button>
            ) : null}
            {canBackup ? (
              <Button
                disabled={Boolean(active)}
                onClick={() => setConfirming(true)}
              >
                {active ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <HardDriveDownload />
                )}
                {active
                  ? `Backing up… ${formatDuration(active.startedAt ?? active.createdAt)}`
                  : "Back up now"}
              </Button>
            ) : null}
          </>
        }
        back={<BackLink href="/database">Database</BackLink>}
        description={
          <>
            {ENGINE_LABELS[current.engine]} {current.serverVersion ?? ""} ·{" "}
            <span className="font-mono text-[13px]">
              {current.databaseName}
            </span>
          </>
        }
        title={current.name}
        titleAdornment={
          <>
            <EnvTag environment={current.environment} />
            <StatusBadge
              status={current.lastCheckError ? "UNREACHABLE" : "REACHABLE"}
            />
          </>
        }
      />
      <FactsStrip connection={current} onChecked={setConnection} />
      {editing ? (
        <EditConnectionForm
          connection={current}
          onDone={(updated) => {
            if (updated) {
              setConnection(updated);
            }
            setEditing(false);
          }}
        />
      ) : null}
      <BackupsSection
        backups={backups}
        canBackup={canBackup}
        freshId={freshId}
        onChanged={() => backups.refetch()}
      />
      {canManage ? (
        <DangerZone
          connection={current}
          disabledReason={
            active ? "Wait for the running backup to finish first." : null
          }
        />
      ) : null}
      <BackupConfirm
        connection={current}
        lastCompleted={history.find(({ status }) => status === "COMPLETED")}
        onConfirm={startBackup}
        onOpenChange={setConfirming}
        open={confirming}
        starting={starting}
      />
    </>
  );
}
