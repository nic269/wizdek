"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
} from "@repo/design-system";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { formatDateTime } from "../../flows/flow-labels";
import { BackupsTable } from "../backups-table";
import { ConnectionUrlField } from "../connection-url-field";
import {
  type DatabaseConnection,
  ENGINE_LABELS,
  isBackupActive,
} from "../database-labels";

const REFRESH_INTERVAL_MS = 3000;

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate text-sm" title={value}>
        {value}
      </dd>
    </div>
  );
}

/** Rename the connection, or replace its URL when the password changed. */
function EditConnectionForm({
  connection,
  onDone,
}: {
  connection: DatabaseConnection;
  onDone: (updated: DatabaseConnection | null) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(connection.name);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.databaseConnections.update({
        connectionId: connection.id,
        name,
        ...(url.trim() ? { url } : {}),
      });
      onDone(data);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the connection."));
      setIsSaving(false);
    }
  };

  return (
    <form className="space-y-4 border-t pt-4" onSubmit={submit}>
      <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor={nameId}>
          Name
        </label>
        <Input
          id={nameId}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </div>
      <ConnectionUrlField
        onChange={setUrl}
        placeholder="Leave blank to keep the saved URL"
        required={false}
        value={url}
      />
      {error ? <ErrorState message={error} /> : null}
      <div className="flex gap-2">
        <Button disabled={isSaving} type="submit">
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
        <Button onClick={() => onDone(null)} type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}

type BusyAction = "backup" | "check" | "delete";

/** Runs one action at a time and turns its failure into a message. */
const useAction = () => {
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    action: BusyAction,
    work: () => Promise<void>,
    fallback: string
  ) => {
    setError(null);
    setBusy(action);
    try {
      await work();
    } catch (cause) {
      setError(getApiErrorMessage(cause, fallback));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
};

function DeleteConnectionConfirm({
  connectionId,
  disabledReason,
  onCancel,
}: {
  connectionId: string;
  disabledReason: string | null;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
      <p className="w-full text-sm">
        Delete this connection? Its saved URL is removed. Finished backups are
        kept and stay listed on the Database page until you delete them.
      </p>
      {error ? <ErrorState message={error} /> : null}
      <Button
        disabled={busy !== null || disabledReason !== null}
        onClick={() =>
          run(
            "delete",
            async () => {
              await apiClient.databaseConnections.delete({ connectionId });
              router.push("/database");
            },
            "Could not delete the connection."
          )
        }
        size="sm"
        variant="destructive"
      >
        Confirm delete
      </Button>
      <Button onClick={onCancel} size="sm" variant="ghost">
        Cancel
      </Button>
      {disabledReason ? (
        <p className="w-full text-muted-foreground text-xs">{disabledReason}</p>
      ) : null}
    </div>
  );
}

function ConnectionCard({
  canManage,
  connection,
  hasActiveBackup,
  onUpdated,
}: {
  canManage: boolean;
  connection: DatabaseConnection;
  hasActiveBackup: boolean;
  onUpdated: (connection: DatabaseConnection) => void;
}) {
  const [mode, setMode] = useState<"confirm-delete" | "edit" | "view">("view");
  const { busy, error, run } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail
            label="Host"
            value={`${connection.host}:${connection.port}`}
          />
          <Detail label="Database" value={connection.databaseName} />
          <Detail label="User" value={connection.username} />
          <Detail
            label="Server version"
            value={connection.serverVersion ?? "unknown"}
          />
        </dl>
        <p className="text-muted-foreground text-sm">
          Last checked {formatDateTime(connection.lastCheckedAt)}.
        </p>
        {connection.lastCheckError ? (
          <p className="whitespace-normal text-destructive text-sm">
            {connection.lastCheckError}
          </p>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy !== null}
            onClick={() =>
              run(
                "check",
                async () => {
                  const { data } = await apiClient.databaseConnections.check({
                    connectionId: connection.id,
                  });
                  onUpdated(data);
                },
                "Could not check the connection."
              )
            }
            variant="outline"
          >
            {busy === "check" ? "Checking..." : "Check connection"}
          </Button>
          {canManage && mode === "view" ? (
            <>
              <Button onClick={() => setMode("edit")} variant="outline">
                Edit
              </Button>
              <Button onClick={() => setMode("confirm-delete")} variant="ghost">
                Delete
              </Button>
            </>
          ) : null}
        </div>
        {mode === "confirm-delete" ? (
          <DeleteConnectionConfirm
            connectionId={connection.id}
            disabledReason={
              hasActiveBackup
                ? "Wait for the running backup to finish first."
                : null
            }
            onCancel={() => setMode("view")}
          />
        ) : null}
        {mode === "edit" ? (
          <EditConnectionForm
            connection={connection}
            onDone={(updated) => {
              if (updated) {
                onUpdated(updated);
              }
              setMode("view");
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function BackupsSection({
  backups,
  canBackup,
  connectionId,
}: {
  backups: ReturnType<typeof useConnectionBackups>;
  canBackup: boolean;
  connectionId: string;
}) {
  const { busy, error, run } = useAction();
  const history = backups.data?.data ?? [];
  const hasActiveBackup = history.some((backup) =>
    isBackupActive(backup.status)
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Backups</h2>
          <p className="text-muted-foreground text-sm">
            A full copy of the database in PostgreSQL's custom format,
            restorable with pg_restore. Files are kept until you delete them.
          </p>
        </div>
        {canBackup ? (
          <Button
            disabled={busy !== null || hasActiveBackup}
            onClick={() =>
              run(
                "backup",
                async () => {
                  await apiClient.databaseBackups.start({ connectionId });
                  await backups.refetch();
                },
                "Could not start the backup."
              )
            }
          >
            {hasActiveBackup ? "Backup running..." : "Back up now"}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorState message={error} /> : null}
      {backups.isError ? (
        <ErrorState
          message={getApiErrorMessage(backups.error, "Could not load backups.")}
        />
      ) : null}
      {backups.isPending ? <LoadingState label="Loading backups" /> : null}
      {backups.data && history.length === 0 ? (
        <EmptyState
          description={
            canBackup
              ? "Choose Back up now to take the first one."
              : "No backup has been taken yet."
          }
          title="No backups"
        />
      ) : null}
      {history.length > 0 ? (
        <BackupsTable
          backups={history}
          canBackup={canBackup}
          onChanged={() => backups.refetch()}
        />
      ) : null}
    </section>
  );
}

const useConnectionBackups = (connectionId: string) =>
  useQuery({
    queryFn: () => apiClient.databaseBackups.list({ connectionId }),
    queryKey: ["database-connection-backups", connectionId],
    // Keeps refreshing only while a backup can still change.
    refetchInterval: (query) =>
      query.state.data?.data.some((backup) => isBackupActive(backup.status))
        ? REFRESH_INTERVAL_MS
        : false,
  });

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
  const connectionKey = ["database-connection", connectionId];
  const connection = useQuery({
    queryFn: () => apiClient.databaseConnections.get({ connectionId }),
    queryKey: connectionKey,
  });
  const backups = useConnectionBackups(connectionId);

  if (connection.isError) {
    return (
      <ErrorState
        message={getApiErrorMessage(
          connection.error,
          "Could not load the connection."
        )}
      />
    );
  }
  if (!connection.data) {
    return <LoadingState label="Loading connection" />;
  }
  const current = connection.data.data;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <a
            className="text-muted-foreground text-sm underline"
            href="/database"
          >
            All connections
          </a>
        }
        description={`${ENGINE_LABELS[current.engine]} database ${current.databaseName}`}
        title={current.name}
      />
      <ConnectionCard
        canManage={canManage}
        connection={current}
        hasActiveBackup={
          backups.data?.data.some((backup) => isBackupActive(backup.status)) ??
          false
        }
        onUpdated={(updated) =>
          queryClient.setQueryData(connectionKey, { data: updated })
        }
      />
      <BackupsSection
        backups={backups}
        canBackup={canBackup}
        connectionId={connectionId}
      />
    </div>
  );
}
