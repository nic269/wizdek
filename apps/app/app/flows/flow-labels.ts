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
