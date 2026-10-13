import type { apiClient } from "@repo/api/client";

export type FlowListItem = Awaited<
  ReturnType<typeof apiClient.flows.list>
>["data"][number];

export type FlowRunStatus = NonNullable<FlowListItem["lastRun"]>["status"];

export const FLOW_STATUS_LABELS: Record<FlowListItem["status"], string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
  DRAFT: "Draft",
};

export const RUN_STATUS_LABELS: Record<FlowRunStatus, string> = {
  CANCELED: "Canceled",
  FAILED: "Failed",
  PARTIALLY_FAILED: "Partially failed",
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
};

export const RUN_STATUS_VARIANTS: Record<
  FlowRunStatus,
  "default" | "destructive" | "outline" | "secondary"
> = {
  CANCELED: "outline",
  FAILED: "destructive",
  PARTIALLY_FAILED: "destructive",
  QUEUED: "secondary",
  RUNNING: "secondary",
  SUCCEEDED: "default",
};

export const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "never";

const ACTIVE_RUN_STATUSES: ReadonlySet<FlowRunStatus> = new Set([
  "QUEUED",
  "RUNNING",
]);

/** Whether a run can still change, and so is worth refreshing. */
export const isRunActive = (status: FlowRunStatus) =>
  ACTIVE_RUN_STATUSES.has(status);

/** How long a run took, or has taken so far. */
export const formatDuration = (
  startedAt: string | null,
  completedAt: string | null
): string => {
  if (!startedAt) {
    return "not started";
  }
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(
    0,
    Math.round((end - new Date(startedAt).getTime()) / 1000)
  );
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const ITEM_COUNT_ORDER = [
  ["SUCCEEDED", "succeeded"],
  ["FAILED", "failed"],
  ["UNKNOWN", "unknown"],
  ["IN_PROGRESS", "in progress"],
  ["PENDING", "pending"],
] as const;

/** "48 succeeded, 2 failed", leaving out statuses with no items. */
export const formatItemCounts = (counts: Record<string, number>): string =>
  ITEM_COUNT_ORDER.filter(([status]) => (counts[status] ?? 0) > 0)
    .map(([status, label]) => `${counts[status]} ${label}`)
    .join(", ") || "no items";
