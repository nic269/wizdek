"use client";

import {
  Button,
  cn,
  ErrorAlert,
  Shimmer,
  StatusBadge,
} from "@repo/design-system";
import { formatRelative } from "../../lib/format";
import { formatRunDuration } from "./output-tab";
import { useFunctionRuns } from "./use-function-run";

const TRIGGER_LABELS = {
  HTTP: "HTTP",
  MANUAL: "Manual",
  SCHEDULE: "Schedule",
} as const;

/** Past runs; choosing one shows it on the Output tab. */
export function HistoryTab({
  functionId,
  onSelect,
  selectedRunId,
}: {
  functionId: string;
  onSelect: (runId: string) => void;
  selectedRunId: string | null;
}) {
  const runs = useFunctionRuns(functionId);
  const all = runs.data?.pages.flatMap((page) => page.data) ?? [];

  if (runs.isLoading) {
    return (
      <div className="space-y-3 p-4" role="status">
        <span className="sr-only">Loading runs</span>
        <Shimmer className="w-3/4" />
        <Shimmer className="w-2/3" />
        <Shimmer className="w-3/4" />
      </div>
    );
  }
  if (runs.isError) {
    return (
      <div className="p-4">
        <ErrorAlert
          onRetry={() => runs.refetch()}
          title="Couldn't load the runs."
        />
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <p className="p-4 text-[13px] text-muted-foreground">No runs yet.</p>
    );
  }

  return (
    <div className="flex flex-col">
      <ul aria-label="Runs" className="divide-y divide-border">
        {all.map((run) => (
          <li key={run.id}>
            <button
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover",
                run.id === selectedRunId && "bg-hover"
              )}
              data-testid={`history-run-${run.number}`}
              onClick={() => onSelect(run.id)}
              type="button"
            >
              <span className="w-9 shrink-0 font-medium text-[12.5px] tabular-nums">
                #{run.number}
              </span>
              <StatusBadge status={run.status} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                {TRIGGER_LABELS[run.trigger]}
                {run.startedByName ? ` · ${run.startedByName}` : ""} ·{" "}
                {formatRelative(run.createdAt)}
              </span>
              <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                {formatRunDuration(run.durationMs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {runs.hasNextPage ? (
        <Button
          className="m-3"
          disabled={runs.isFetchingNextPage}
          onClick={() => runs.fetchNextPage()}
          size="sm"
          type="button"
          variant="outline"
        >
          {runs.isFetchingNextPage ? "Loading…" : "Load older runs"}
        </Button>
      ) : null}
    </div>
  );
}
