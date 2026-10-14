"use client";

import { apiClient } from "@repo/api/client";
import {
  Button,
  EmptyState,
  EnvTag,
  ErrorAlert,
  History,
  SkeletonRows,
  StatusBadge,
} from "@repo/design-system";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDuration, formatWhen } from "../../../lib/format";
import { isRunActive } from "../../../lib/queries";
import { RunItemsBar, summarizeItems } from "../../../lib/run-items-bar";

type RunsPage = Awaited<ReturnType<typeof apiClient.flows.runs.list>>;
type RunRow = RunsPage["data"][number];

const PAGE_SIZE = 20;
const REFRESH_INTERVAL_MS = 3000;
const COLUMNS =
  "70px 150px minmax(170px,1fr) 150px 120px 90px minmax(200px,1.2fr)";

/** "240 · 9 ✗ · 3 ?", or "88 / 150" while items are still waiting. */
export const itemSummary = (counts: Record<string, number>) => {
  const { failed, running, total, unknown } = summarizeItems(counts);
  if (running > 0) {
    return `${(total - running).toLocaleString()} / ${total.toLocaleString()}`;
  }
  return [
    total.toLocaleString(),
    failed > 0 ? `${failed} ✗` : null,
    unknown > 0 ? `${unknown} ?` : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const RunTableRow = ({ flowId, run }: { flowId: string; run: RunRow }) => {
  const router = useRouter();
  const href = `/flows/${flowId}/runs/${run.id}`;
  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      <TableCell className="h-[54px]">
        <Link
          className="font-medium font-mono text-[12.5px] text-foreground-2 hover:underline"
          href={href}
          onClick={(event) => event.stopPropagation()}
        >
          #{run.number}
        </Link>
      </TableCell>
      <TableCell>
        <StatusBadge status={run.status} />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-[7px] text-[13px] text-foreground">
          <span className="truncate">{run.storeName}</span>
          <EnvTag environment={run.storeEnvironment} />
        </span>
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {formatWhen(run.startedAt ?? run.createdAt)}
      </TableCell>
      <TableCell className="text-[13px] text-foreground">
        {run.startedByName ?? "Automatic"}
      </TableCell>
      <TableCell className="font-mono text-[12.5px]">
        {run.startedAt ? formatDuration(run.startedAt, run.completedAt) : "—"}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2.5">
          <RunItemsBar className="flex-1" counts={run.itemCounts} />
          <span className="whitespace-nowrap font-medium font-mono text-muted-foreground text-xs">
            {itemSummary(run.itemCounts)}
          </span>
        </span>
      </TableCell>
    </TableRow>
  );
};

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

  if (runs.isError) {
    return (
      <ErrorAlert
        message="Runs in progress are not affected."
        onRetry={() => runs.refetch()}
        title="Couldn't load runs."
      />
    );
  }
  const rows = runs.data?.pages.flatMap((page) => page.data) ?? [];
  if (!runs.isPending && rows.length === 0) {
    return (
      <EmptyState
        action={
          <Link
            className="font-medium text-accent-ink text-sm hover:underline"
            href={`/flows/${flowId}`}
          >
            Open the flow
          </Link>
        }
        description="Open the flow and choose Run to start one. Every run is listed here with its per-step trace."
        icon={<History />}
        title="This flow has not run yet"
      />
    );
  }

  return (
    <>
      <Table className="min-w-[900px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[86px]">Run</TableHead>
            <TableHead className="w-[166px]">Status</TableHead>
            <TableHead>Store</TableHead>
            <TableHead className="w-[166px]">Started</TableHead>
            <TableHead className="w-[136px]">Started by</TableHead>
            <TableHead className="w-[106px]">Duration</TableHead>
            <TableHead className="w-[26%]">Items</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.isPending ? (
            <TableRow className="hover:bg-transparent">
              <TableCell className="h-auto p-0" colSpan={7}>
                <SkeletonRows
                  columns={COLUMNS}
                  label="Loading runs"
                  rowHeight={54}
                />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((run) => (
              <RunTableRow flowId={flowId} key={run.id} run={run} />
            ))
          )}
        </TableBody>
      </Table>
      {runs.hasNextPage ? (
        <Button
          className="self-start"
          disabled={runs.isFetchingNextPage}
          onClick={() => runs.fetchNextPage()}
          variant="outline"
        >
          {runs.isFetchingNextPage ? "Loading…" : "Load older runs"}
        </Button>
      ) : null}
    </>
  );
}
