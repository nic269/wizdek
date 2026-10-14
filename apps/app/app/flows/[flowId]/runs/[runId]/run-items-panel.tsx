"use client";

import { apiClient } from "@repo/api/client";
import {
  Button,
  cn,
  ErrorAlert,
  ExternalLink,
  InlineAlert,
  StatusBadge,
} from "@repo/design-system";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system/components/ui/tabs";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminUrl, errorText, itemRow, itemTitle } from "./trace-model";
import { RUN_POLL_INTERVAL_MS } from "./use-run-polling";

type ItemsPage = Awaited<ReturnType<typeof apiClient.flows.runs.items.list>>;
type RunItem = ItemsPage["data"][number];
export type ItemFilter = "ALL" | "UNKNOWN" | "FAILED" | "SUCCEEDED";

const PAGE_SIZE = 50;

const FILTERS: { label: string; tone: string; value: ItemFilter }[] = [
  {
    label: "All",
    tone: "border-foreground bg-foreground text-white",
    value: "ALL",
  },
  {
    label: "Unknown",
    tone: "border-(--status-unknown-bg) bg-(--status-unknown-bg) text-white",
    value: "UNKNOWN",
  },
  {
    label: "Failed",
    tone: "border-(--status-danger-dot) bg-(--status-danger-bg) text-(--status-danger-fg)",
    value: "FAILED",
  },
  {
    label: "Succeeded",
    tone: "border-(--status-success-dot) bg-(--status-success-bg) text-(--status-success-fg)",
    value: "SUCCEEDED",
  },
];

const json = (value: unknown, empty: string) =>
  value === null || value === undefined
    ? empty
    : JSON.stringify(value, null, 2);

const ItemDetail = ({
  item,
  shopDomain,
  stepName,
}: {
  item: RunItem;
  shopDomain: string;
  stepName: string;
}) => {
  const message = errorText(item.error);
  const link = adminUrl(item, shopDomain);
  const row = itemRow(item);
  const [tab, setTab] = useState(message ? "error" : "output");
  useEffect(() => setTab(message ? "error" : "output"), [message]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono font-semibold text-sm leading-none">
          {itemTitle(item)}
        </span>
        <span className="text-muted-foreground text-xs">
          {row === null ? item.itemKey : `row ${row}`}
        </span>
        <span className="flex-1" />
        {link ? (
          <a
            className="inline-flex items-center gap-1.5 font-medium text-[12.5px] text-accent-ink hover:underline"
            href={link}
            rel="noreferrer"
            target="_blank"
          >
            Open in Shopify
            <ExternalLink className="size-[13px]" />
          </a>
        ) : null}
      </div>
      {item.status === "UNKNOWN" ? (
        <InlineAlert title="Needs a human check." tone="unknown">
          {message ?? "The step's call may or may not have reached Shopify."}{" "}
          Look at it in Shopify before running the flow again — re-running may
          apply the change twice.
        </InlineAlert>
      ) : null}
      {item.status === "FAILED" ? (
        <InlineAlert title={`${stepName} failed.`} tone="danger">
          {message ?? "No reason was recorded."}
        </InlineAlert>
      ) : null}
      <Tabs onValueChange={(value) => setTab(String(value))} value={tab}>
        <TabsList
          className="w-full justify-start gap-0.5 border-border border-b"
          variant="line"
        >
          <TabsTrigger className="flex-none px-2.5 text-[12.5px]" value="input">
            Input
          </TabsTrigger>
          <TabsTrigger
            className="flex-none px-2.5 text-[12.5px]"
            value="output"
          >
            Output
          </TabsTrigger>
          <TabsTrigger className="flex-none px-2.5 text-[12.5px]" value="error">
            Error
          </TabsTrigger>
        </TabsList>
        {(
          [
            ["input", json(item.input, "// No input.")],
            [
              "output",
              json(
                item.output,
                "// No output — the item did not complete this step."
              ),
            ],
            ["error", json(item.error, "// No error.")],
          ] as const
        ).map(([value, text]) => (
          <TabsContent key={value} value={value}>
            <pre className="m-0 mt-3 overflow-auto whitespace-pre-wrap rounded-menu border border-border bg-sunken p-3 font-mono text-foreground-2 text-xs leading-[1.6]">
              {text}
            </pre>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

/** The run's items, scoped to a step and a status, with what each one did. */
export function RunItemsPanel({
  counts,
  filter,
  isRunActive,
  onFilterChange,
  runId,
  selectedStep,
  shopDomain,
  stepNames,
}: {
  /** Items in each status, for the filter pills. */
  counts: Record<string, number>;
  filter: ItemFilter;
  isRunActive: boolean;
  onFilterChange: (filter: ItemFilter) => void;
  runId: string;
  selectedStep: string | null;
  shopDomain: string;
  stepNames: ReadonlyMap<string, string>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = useInfiniteQuery({
    getNextPageParam: (lastPage: ItemsPage) =>
      lastPage.pageInfo.nextCursor ?? undefined,
    initialPageParam: "",
    queryFn: ({ pageParam }): Promise<ItemsPage> =>
      apiClient.flows.runs.items.list({
        limit: PAGE_SIZE,
        runId,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(selectedStep ? { nodeId: selectedStep } : {}),
        ...(filter === "ALL" ? {} : { status: filter }),
      }),
    queryKey: ["flow-run-items", runId, selectedStep ?? "", filter],
    refetchInterval: isRunActive ? RUN_POLL_INTERVAL_MS : false,
  });
  const rows = items.data?.pages.flatMap((page) => page.data) ?? [];
  const selected = rows.find(({ id }) => id === selectedId) ?? rows[0];
  const stepLabel = (item: RunItem) => {
    const name = stepNames.get(item.nodeId) ?? item.nodeId;
    return item.outputHandle && item.outputHandle !== "main"
      ? `${name} → ${item.outputHandle}`
      : name;
  };

  return (
    <aside
      aria-label="Items"
      className="flex min-h-0 flex-col"
      data-testid="run-items-panel"
    >
      <div className="flex flex-col gap-2.5 border-border border-b px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-semibold text-[13.5px] leading-none">
            Items
          </h2>
          <span className="text-muted-foreground text-xs">
            {selectedStep
              ? `in ${stepNames.get(selectedStep) ?? selectedStep} · click the step again to clear`
              : "all steps"}
          </span>
        </div>
        <fieldset
          aria-label="Item status"
          className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
        >
          {FILTERS.map((option) => {
            const active = filter === option.value;
            const count =
              option.value === "ALL"
                ? Object.values(counts).reduce((sum, value) => sum + value, 0)
                : (counts[option.value] ?? 0);
            return (
              <Button
                aria-pressed={active}
                className={cn(
                  "h-[26px] gap-1.5 rounded-full px-[9px] font-medium text-xs",
                  active
                    ? option.tone
                    : "border-input bg-card text-foreground-2"
                )}
                key={option.value}
                onClick={() => onFilterChange(option.value)}
                variant="outline"
              >
                {option.label}
                <span className="font-medium font-mono text-[11px] opacity-75">
                  {count.toLocaleString()}
                </span>
              </Button>
            );
          })}
        </fieldset>
      </div>
      <div className="max-h-[40%] flex-[0_1_auto] overflow-y-auto border-border border-b">
        {items.isPending ? (
          <p
            className="px-3.5 py-3 text-muted-foreground text-xs"
            role="status"
          >
            Loading items…
          </p>
        ) : null}
        {items.isError ? (
          <ErrorAlert
            className="m-3"
            onRetry={() => items.refetch()}
            title="Couldn't load items."
          />
        ) : null}
        {items.isSuccess && rows.length === 0 ? (
          <p className="px-3.5 py-3 text-muted-foreground text-xs">
            No items to show.
          </p>
        ) : null}
        <ul>
          {rows.map((item) => {
            const row = itemRow(item);
            return (
              <li key={item.id}>
                <Button
                  aria-pressed={selected?.id === item.id}
                  className={cn(
                    "h-auto w-full justify-start gap-2.5 rounded-none border-0 border-border border-b px-3.5 py-2 text-left font-normal",
                    selected?.id === item.id
                      ? "bg-accent-soft hover:bg-accent-soft"
                      : ""
                  )}
                  onClick={() => setSelectedId(item.id)}
                  variant="ghost"
                >
                  <span className="w-[34px] font-medium font-mono text-[11.5px] text-faint">
                    {row ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium font-mono text-[13px]">
                    {itemTitle(item)}
                  </span>
                  <span className="truncate text-muted-foreground text-xs">
                    {stepLabel(item)}
                  </span>
                  <StatusBadge
                    className="h-5 px-[7px] text-[11px]"
                    status={item.status}
                  />
                </Button>
              </li>
            );
          })}
        </ul>
        {items.hasNextPage ? (
          <Button
            className="m-2"
            disabled={items.isFetchingNextPage}
            onClick={() => items.fetchNextPage()}
            size="xs"
            variant="outline"
          >
            {items.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
      {selected ? (
        <ItemDetail
          item={selected}
          key={selected.id}
          shopDomain={shopDomain}
          stepName={stepNames.get(selected.nodeId) ?? selected.nodeId}
        />
      ) : (
        <p className="p-3.5 text-muted-foreground text-sm">
          Select an item to see its input, output and error.
        </p>
      )}
    </aside>
  );
}
