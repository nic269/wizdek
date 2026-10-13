"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  formatDateTime,
  formatDuration,
  formatItemCounts,
  isRunActive,
  RUN_STATUS_LABELS,
  RUN_STATUS_VARIANTS,
} from "../../flow-labels";

type RunsPage = Awaited<ReturnType<typeof apiClient.flows.runs.list>>;

const PAGE_SIZE = 20;
const REFRESH_INTERVAL_MS = 3000;

export function RunsPanel({ flowId }: { flowId: string }) {
  const runs = useInfiniteQuery({
    getNextPageParam: (lastPage: RunsPage) =>
      lastPage.pageInfo.nextCursor ?? undefined,
    // An empty cursor means the first page.
    initialPageParam: "",
    queryFn: ({ pageParam }): Promise<RunsPage> =>
      apiClient.flows.runs.list({
        flowId,
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    queryKey: ["flow-runs", flowId],
    // Keeps refreshing only while a listed run can still change.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.data.some((run) => isRunActive(run.status))
      )
        ? REFRESH_INTERVAL_MS
        : false,
  });

  if (runs.isPending) {
    return <LoadingState label="Loading runs" />;
  }
  if (runs.isError) {
    return (
      <ErrorState
        message={getApiErrorMessage(runs.error, "Could not load runs.")}
      />
    );
  }
  const rows = runs.data.pages.flatMap((page) => page.data);
  if (rows.length === 0) {
    return (
      <EmptyState
        description="Open the flow and choose Run to start one."
        title="This flow has not run yet"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Started by</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Items</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <a
                    className="font-medium hover:underline"
                    href={`/flows/${flowId}/runs/${run.id}`}
                  >
                    {formatDateTime(run.startedAt ?? run.createdAt)}
                  </a>
                </TableCell>
                <TableCell>
                  <Badge variant={RUN_STATUS_VARIANTS[run.status]}>
                    {RUN_STATUS_LABELS[run.status]}
                  </Badge>
                </TableCell>
                <TableCell>{run.storeName}</TableCell>
                <TableCell>{run.startedByName ?? "Automatic"}</TableCell>
                <TableCell>
                  {formatDuration(run.startedAt, run.completedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {formatItemCounts(run.itemCounts)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {runs.hasNextPage ? (
        <Button
          disabled={runs.isFetchingNextPage}
          onClick={() => runs.fetchNextPage()}
          variant="outline"
        >
          {runs.isFetchingNextPage ? "Loading..." : "Load older runs"}
        </Button>
      ) : null}
    </div>
  );
}
