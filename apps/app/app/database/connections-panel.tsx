"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  ChevronRight,
  Database,
  EmptyState,
  type Environment,
  EnvTag,
  ErrorAlert,
  Input,
  LoaderCircle,
  Lock,
  PageHeader,
  Plus,
  ReadOnlyBanner,
  SegmentedControl,
  SkeletonRows,
  StatusBadge,
  toast,
  X,
} from "@repo/design-system";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/design-system/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { formatBytes, formatRelative, formatWhen } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import {
  type DatabaseBackup,
  type DatabaseConnection,
  queryKeys,
  useDatabaseConnections,
  useOrganizationBackups,
} from "../lib/queries";
import { ENVIRONMENT_OPTIONS } from "../stores/store-drawer";
import { ConnectionUrlField } from "./connection-url-field";

const COLUMNS = "minmax(220px,1.4fr) minmax(220px,1.4fr) 170px 190px 40px";

/** A database's mark: a cylinder on a blue tint. */
export const DatabaseChip = ({ size = 30 }: { size?: number }) => (
  <span
    aria-hidden="true"
    className="grid shrink-0 place-items-center rounded-[7px] bg-[oklch(0.95_0.03_240)] text-[oklch(0.45_0.1_240)]"
    style={{ height: size, width: size }}
  >
    <Database className="size-[15px]" />
  </span>
);

const backupMeta = (backup: DatabaseBackup) => {
  if (backup.status === "FAILED") {
    return `${formatWhen(backup.createdAt)} · failed`;
  }
  if (backup.status === "COMPLETED") {
    return `${formatWhen(backup.completedAt ?? backup.createdAt)} · ${formatBytes(backup.sizeBytes)}`;
  }
  return `Started ${formatRelative(backup.startedAt ?? backup.createdAt)}`;
};

const AddConnectionSheet = ({
  onClose,
  open,
  organizationId,
}: {
  onClose: () => void;
  open: boolean;
  organizationId: string;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [environment, setEnvironment] = useState<Environment>("DEV");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { data } = await apiClient.databaseConnections.create({
        environment,
        name,
        organizationId,
        url,
      });
      setUrl("");
      toast.success("Connection added", {
        description:
          `Reachable · PostgreSQL ${data.serverVersion ?? ""}`.trim(),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.connections(organizationId),
      });
      router.push(`/database/${data.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Could not save the connection."));
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet onOpenChange={(next) => (next ? null : onClose())} open={open}>
      <SheetContent
        className="w-[min(440px,calc(100vw-16px))] gap-0 p-0 sm:max-w-none"
        showCloseButton={false}
        side="right"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="flex items-center border-border border-b px-5 py-[18px]">
            <div className="flex-1">
              <SheetTitle className="font-semibold text-base leading-[1.3]">
                Add a connection
              </SheetTitle>
              <SheetDescription className="text-[12.5px] text-muted-foreground leading-[1.4]">
                We test the connection before saving.
              </SheetDescription>
            </div>
            <Button
              aria-label="Close"
              className="text-muted-foreground"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-[17px]" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
            {error ? <ErrorAlert message={error} title="Not saved." /> : null}
            <Field className="gap-1.5">
              <FieldLabel htmlFor="connection-name">Name</FieldLabel>
              <Input
                id="connection-name"
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="Evisu production"
                required
                value={name}
              />
            </Field>
            <ConnectionUrlField onChange={setUrl} value={url} />
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
            <p className="text-muted-foreground text-xs leading-[1.45]">
              Only <code className="font-mono">sslmode</code> is read from the
              URL's query string; parameters such as{" "}
              <code className="font-mono">schema</code> are ignored.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-border border-t px-5 py-3.5">
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
              {isSubmitting ? "Testing connection…" : "Test & save"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

const ConnectionRow = ({
  connection,
  latest,
}: {
  connection: DatabaseConnection;
  latest: DatabaseBackup | undefined;
}) => {
  const router = useRouter();
  return (
    <TableRow
      className="cursor-pointer"
      data-testid={`database-connection-${connection.id}`}
      onClick={() => router.push(`/database/${connection.id}`)}
    >
      <TableCell className="h-16">
        <div className="flex min-w-0 items-center gap-[11px]">
          <DatabaseChip />
          <div className="min-w-0">
            <div className="flex items-center gap-[7px]">
              <span className="truncate font-semibold text-[13.5px] text-foreground leading-[1.3]">
                {connection.name}
              </span>
              <EnvTag environment={connection.environment} />
            </div>
            <div className="text-muted-foreground text-xs leading-[1.4]">
              PostgreSQL {connection.serverVersion ?? ""}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="min-w-0">
          <div className="truncate font-medium font-mono text-[13px] text-foreground leading-[1.3]">
            {connection.databaseName}
          </div>
          <div
            className="truncate font-mono text-muted-foreground text-xs leading-[1.4]"
            title={`${connection.host}:${connection.port}`}
          >
            {connection.host}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <StatusBadge
            status={connection.lastCheckError ? "UNREACHABLE" : "REACHABLE"}
          />
          <span className="text-[11.5px] text-muted-foreground leading-none">
            {connection.lastCheckedAt
              ? `${connection.lastCheckError ? "Failed" : "Checked"} ${formatRelative(connection.lastCheckedAt)}`
              : "Not checked yet"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {latest ? (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={latest.status} />
            <span className="text-[11.5px] text-muted-foreground leading-none">
              {backupMeta(latest)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">No backups yet</span>
        )}
      </TableCell>
      <TableCell>
        <ChevronRight className="size-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
};

const NoAccess = () => (
  <EmptyState
    description="Seeing database connections needs the databases:read permission, because a connection reaches production data. Ask an Owner for access."
    icon={<Lock />}
    title="You don't have permission to see databases"
  />
);

const ConnectionsTable = ({
  isLoading,
  latest,
  list,
}: {
  isLoading: boolean;
  latest: Map<string, DatabaseBackup>;
  list: DatabaseConnection[];
}) => (
  <Table className="min-w-[860px] table-fixed">
    <TableHeader>
      <TableRow>
        <TableHead>Connection</TableHead>
        <TableHead>Database</TableHead>
        <TableHead className="w-[186px]">Reachability</TableHead>
        <TableHead className="w-[206px]">Last backup</TableHead>
        <TableHead className="w-[56px]">
          <span className="sr-only">Open</span>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {isLoading ? (
        <TableRow className="hover:bg-transparent">
          <TableCell className="h-auto p-0" colSpan={5}>
            <SkeletonRows
              columns={COLUMNS}
              count={3}
              label="Loading connections"
            />
          </TableCell>
        </TableRow>
      ) : (
        list.map((connection) => (
          <ConnectionRow
            connection={connection}
            key={connection.id}
            latest={latest.get(connection.id)}
          />
        ))
      )}
    </TableBody>
  </Table>
);

/** The newest backup of each connection. */
const latestBackups = (backups: DatabaseBackup[] | undefined) => {
  const latest = new Map<string, DatabaseBackup>();
  for (const backup of backups ?? []) {
    if (backup.connectionId && !latest.has(backup.connectionId)) {
      latest.set(backup.connectionId, backup);
    }
  }
  return latest;
};

const ConnectionsEmpty = ({
  canManage,
  onAdd,
}: {
  canManage: boolean;
  onAdd: () => void;
}) => (
  <EmptyState
    action={
      canManage ? <Button onClick={onAdd}>Add connection</Button> : undefined
    }
    description="Add a PostgreSQL connection to take full backups before a deploy. Backups are restorable with pg_restore."
    icon={<Database />}
    note={
      canManage
        ? undefined
        : "Only people who can manage databases can add one."
    }
    title="No database connections"
  />
);

export function ConnectionsPanel({
  startAdding = false,
}: {
  startAdding?: boolean;
}) {
  const { organization } = useActiveOrganization();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const organizationId = organization?.id ?? null;
  const canRead = can("databases:read");
  const canManage = can("databases:manage");
  const connections = useDatabaseConnections(organizationId, canRead);
  const backups = useOrganizationBackups(organizationId, canRead);
  const [adding, setAdding] = useState(startAdding);

  const latest = latestBackups(backups.data);
  const list = connections.data ?? [];
  const isLoading = permissionsLoading || connections.isLoading;
  const isEmpty = !(isLoading || connections.isError) && list.length === 0;

  return (
    <>
      <PageHeader
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              Add connection
            </Button>
          ) : null
        }
        description={`PostgreSQL databases ${organization?.name ?? "this organization"} can back up. Open a connection to run and download backups.`}
        title="Database"
      />
      {permissionsLoading || canManage || !canRead ? null : (
        <ReadOnlyBanner>
          You can see connections and their backups but not change them. Ask an
          Owner for the <strong>Manage databases</strong> permission to add or
          edit connections.
        </ReadOnlyBanner>
      )}
      {permissionsLoading || canRead ? null : <NoAccess />}
      {connections.isError ? (
        <ErrorAlert
          message="Backups already running continue in the background."
          onRetry={() => connections.refetch()}
          title="Couldn't load connections."
        />
      ) : null}
      {isEmpty ? (
        <ConnectionsEmpty canManage={canManage} onAdd={() => setAdding(true)} />
      ) : null}
      {canRead && !isEmpty && !connections.isError ? (
        <ConnectionsTable isLoading={isLoading} latest={latest} list={list} />
      ) : null}
      {organizationId && canManage ? (
        <AddConnectionSheet
          onClose={() => setAdding(false)}
          open={adding}
          organizationId={organizationId}
        />
      ) : null}
    </>
  );
}
