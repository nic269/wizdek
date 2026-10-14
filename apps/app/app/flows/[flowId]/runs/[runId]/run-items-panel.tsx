"use client";

import { apiClient, getApiErrorMessage } from "@repo/api/client";
import { Button, ErrorState, LoadingState } from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { OptionSelect, type SelectOption } from "../../../../lib/option-select";
import { RUN_POLL_INTERVAL_MS } from "./use-run-polling";

type RunItem = Awaited<
  ReturnType<typeof apiClient.flows.runs.items.list>
>["data"][number];
type ItemStatus = RunItem["status"];

const PAGE_SIZE = 50;

/** The filter option that shows every item, whatever its status. */
const ALL = "ALL";

const STATUS_FILTERS: SelectOption<ItemStatus | typeof ALL>[] = [
  { label: "All items", value: ALL },
  { label: "Succeeded", value: "SUCCEEDED" },
  { label: "Failed", value: "FAILED" },
  { label: "Unknown", value: "UNKNOWN" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Pending", value: "PENDING" },
];

const STATUS_VARIANTS: Record<
  ItemStatus,
  "default" | "destructive" | "outline" | "secondary"
> = {
  FAILED: "destructive",
  IN_PROGRESS: "secondary",
  PENDING: "outline",
  SUCCEEDED: "default",
  UNKNOWN: "destructive",
};

const STATUS_LABELS: Record<ItemStatus, string> = {
  FAILED: "Failed",
  IN_PROGRESS: "In progress",
  PENDING: "Pending",
  SUCCEEDED: "Succeeded",
  UNKNOWN: "Unknown",
};

const errorMessage = (error: unknown): string | null =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : null;

/** JSON shown as text, collapsed until asked for. */
function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return null;
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {label}
      </summary>
      <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

/** The items one node received in a run, with what went in and came out. */
export function RunItemsPanel({
  isRunActive,
  nodeId,
  nodeName,
  runId,
}: {
  isRunActive: boolean;
  nodeId: string;
  nodeName: string;
  runId: string;
}) {
  const [status, setStatus] = useState<ItemStatus | "">("");
  // Cursors of the pages visited so far; the last one is the current page.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);

  // A different node or filter starts again from the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets when either changes
  useEffect(() => {
    setCursors([undefined]);
  }, [nodeId, status]);

  const items = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiClient.flows.runs.items.list({
        limit: PAGE_SIZE,
        nodeId,
        runId,
        ...(cursor ? { cursor } : {}),
        ...(status ? { status } : {}),
      }),
    queryKey: ["flow-run-items", runId, nodeId, status, cursor ?? ""],
    refetchInterval: isRunActive ? RUN_POLL_INTERVAL_MS : false,
  });

  return (
    <aside
      aria-label="Step items"
      className="flex h-full flex-col gap-3 overflow-hidden p-4"
      data-testid="run-items-panel"
    >
      <div>
        <h2 className="font-semibold text-base">{nodeName}</h2>
        <p className="text-muted-foreground text-xs">
          Items this step received, in the order they arrived.
        </p>
      </div>
      <OptionSelect
        aria-label="Item status filter"
        onValueChange={(value) => setStatus(value === ALL ? "" : value)}
        options={STATUS_FILTERS}
        value={status || ALL}
      />
      {items.isPending ? <LoadingState label="Loading items" /> : null}
      {items.isError ? (
        <ErrorState
          message={getApiErrorMessage(items.error, "Could not load items.")}
        />
      ) : null}
      {items.data?.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No items to show.</p>
      ) : null}
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {items.data?.data.map((item) => (
          <li className="space-y-1 rounded-md border p-2" key={item.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-muted-foreground text-xs">
                {item.itemKey}
              </span>
              <Badge variant={STATUS_VARIANTS[item.status]}>
                {STATUS_LABELS[item.status]}
              </Badge>
            </div>
            {errorMessage(item.error) ? (
              <p className="whitespace-pre-wrap break-words text-destructive text-xs">
                {errorMessage(item.error)}
              </p>
            ) : null}
            <JsonDetails label="Input" value={item.input} />
            <JsonDetails label="Output" value={item.output} />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <Button
          disabled={cursors.length === 1}
          onClick={() => setCursors((current) => current.slice(0, -1))}
          size="sm"
          variant="outline"
        >
          Previous
        </Button>
        <span className="text-muted-foreground text-xs">
          Page {cursors.length}
        </span>
        <Button
          disabled={!items.data?.pageInfo.nextCursor}
          onClick={() => {
            const next = items.data?.pageInfo.nextCursor;
            if (next) {
              setCursors((current) => [...current, next]);
            }
          }}
          size="sm"
          variant="outline"
        >
          Next
        </Button>
      </div>
    </aside>
  );
}
