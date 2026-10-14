"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { EmptyState, ErrorState, LoadingState } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { formatDateTime } from "../flows/flow-labels";
import { useActiveOrganization } from "../lib/active-organization";
import { BackupsTable } from "./backups-table";
import {
  BACKUP_STATUS_LABELS,
  BACKUP_STATUS_VARIANTS,
  type DatabaseBackup,
  ENGINE_LABELS,
  isBackupActive,
} from "./database-labels";

const REFRESH_INTERVAL_MS = 3000;

export function ConnectionsPanel() {
  const {
    error: organizationError,
    isLoading,
    organization,
  } = useActiveOrganization();
  const organizationId = organization?.id ?? "";

  const connections = useQuery({
    enabled: Boolean(organizationId),
    queryFn: () => apiClient.databaseConnections.list({ organizationId }),
    queryKey: ["database-connections", organizationId],
  });
  const backups = useQuery({
    enabled: Boolean(organizationId),
    queryFn: () =>
      apiClient.databaseBackups.listForOrganization({ organizationId }),
    queryKey: ["database-backups", organizationId],
    refetchInterval: (query) =>
      query.state.data?.data.some((backup) => isBackupActive(backup.status))
        ? REFRESH_INTERVAL_MS
        : false,
  });

  if (organizationError) {
    return <ErrorState message={organizationError} />;
  }
  if (!(isLoading || organization)) {
    return (
      <EmptyState
        description="Create an organization on the dashboard before adding a database."
        title="No organization"
      />
    );
  }
  if (connections.isError) {
    return (
      <ErrorState
        message={getApiErrorMessage(
          connections.error,
          "Could not load database connections."
        )}
      />
    );
  }
  if (!connections.data) {
    return <LoadingState label="Loading database connections" />;
  }

  const allBackups = backups.data?.data ?? [];
  const latestByConnection = new Map<string, DatabaseBackup>();
  for (const backup of allBackups) {
    if (backup.connectionId && !latestByConnection.has(backup.connectionId)) {
      latestByConnection.set(backup.connectionId, backup);
    }
  }
  const orphaned = allBackups.filter((backup) => backup.connectionId === null);
  const rows = connections.data.data;

  return (
    <div className="space-y-8">
      {rows.length === 0 ? (
        <EmptyState
          description="A connection is a database URL saved encrypted for this organization. Add one to back it up."
          title="No database connections"
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Database</TableHead>
                <TableHead>Last check</TableHead>
                <TableHead>Last backup</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((connection) => {
                const latest = latestByConnection.get(connection.id);
                return (
                  <TableRow
                    data-testid={`database-connection-${connection.name}`}
                    key={connection.id}
                  >
                    <TableCell>
                      <a
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/database/${connection.id}`}
                      >
                        {connection.name}
                      </a>
                      <div className="text-muted-foreground text-xs">
                        {ENGINE_LABELS[connection.engine]}
                        {connection.serverVersion
                          ? ` ${connection.serverVersion.split(" ")[0]}`
                          : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{connection.databaseName}</div>
                      <div
                        className="max-w-56 truncate text-muted-foreground text-xs"
                        title={`${connection.host}:${connection.port}`}
                      >
                        {connection.host}:{connection.port}
                      </div>
                    </TableCell>
                    <TableCell>
                      {connection.lastCheckError ? (
                        <Badge variant="destructive">Unreachable</Badge>
                      ) : (
                        <Badge variant="outline">Reachable</Badge>
                      )}
                      <p className="mt-1 text-muted-foreground text-xs">
                        {formatDateTime(connection.lastCheckedAt)}
                      </p>
                    </TableCell>
                    <TableCell>
                      {latest ? (
                        <>
                          <Badge
                            variant={BACKUP_STATUS_VARIANTS[latest.status]}
                          >
                            {BACKUP_STATUS_LABELS[latest.status]}
                          </Badge>
                          <p className="mt-1 text-muted-foreground text-xs">
                            {formatDateTime(latest.createdAt)}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          None yet
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {orphaned.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-semibold text-lg">
              Backups of deleted connections
            </h2>
            <p className="text-muted-foreground text-sm">
              Kept until you delete them.
            </p>
          </div>
          <BackupsTable
            backups={orphaned}
            canBackup
            onChanged={() => backups.refetch()}
            showConnection
          />
        </section>
      ) : null}
    </div>
  );
}
