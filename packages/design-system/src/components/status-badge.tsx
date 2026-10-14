import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "unknown"
  | "draft";

/**
 * One mapping for every entity state in the product: stores, flows, runs,
 * steps, items, activations, backups, connections and invitations. Unknown
 * is the only solid badge, so an item whose effect is uncertain stands out.
 */
const STATUSES: Record<string, { label: string; tone: StatusTone }> = {
  ACCEPTED: { label: "Accepted", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
  CANCELED: { label: "Canceled", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "success" },
  CONNECTED: { label: "Connected", tone: "success" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
  DRAFT: { label: "Draft", tone: "draft" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  PARTIALLY_FAILED: { label: "Partially failed", tone: "warning" },
  PENDING: { label: "Pending", tone: "info" },
  QUEUED: { label: "Queued", tone: "neutral" },
  REACHABLE: { label: "Reachable", tone: "success" },
  RECONNECT_REQUIRED: { label: "Reconnect required", tone: "warning" },
  REVOKED: { label: "Revoked", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  UNKNOWN: { label: "Unknown", tone: "unknown" },
  UNREACHABLE: { label: "Unreachable", tone: "danger" },
};

const TONE_CLASSES: Record<StatusTone, string> = {
  danger:
    "bg-(--status-danger-bg) text-(--status-danger-fg) [--dot:var(--status-danger-dot)]",
  draft:
    "border border-input bg-card text-(--status-neutral-fg) [--dot:var(--status-neutral-dot)]",
  info: "bg-(--status-info-bg) text-(--status-info-fg) [--dot:var(--status-info-dot)]",
  neutral:
    "bg-(--status-neutral-bg) text-(--status-neutral-fg) [--dot:var(--status-neutral-dot)]",
  success:
    "bg-(--status-success-bg) text-(--status-success-fg) [--dot:var(--status-success-dot)]",
  unknown:
    "bg-(--status-unknown-bg) text-(--status-unknown-fg) [--dot:var(--status-unknown-dot)]",
  warning:
    "bg-(--status-warning-bg) text-(--status-warning-fg) [--dot:var(--status-warning-dot)]",
};

/** The tone and label of a status value, for callers that colour other UI by it. */
export const describeStatus = (status: string) =>
  STATUSES[status] ?? {
    label:
      status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " "),
    tone: "neutral" as StatusTone,
  };

export const statusToneClass = (tone: StatusTone) => TONE_CLASSES[tone];

export const StatusBadge = ({
  status,
  tone,
  children,
  className,
}: {
  /** An entity status such as `CONNECTED`, `RUNNING` or `UNKNOWN`. */
  status?: string | undefined;
  /** Overrides the tone the status maps to. */
  tone?: StatusTone | undefined;
  /** Overrides the label the status maps to. */
  children?: ReactNode | undefined;
  className?: string | undefined;
}) => {
  const described = status ? describeStatus(status) : undefined;
  const resolvedTone = tone ?? described?.tone ?? "neutral";
  const running = status === "RUNNING" || status === "IN_PROGRESS";
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 font-medium text-xs leading-none",
        TONE_CLASSES[resolvedTone],
        className
      )}
      data-status={status}
      data-tone={resolvedTone}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-(--dot)",
          running && "animate-[wz-pulse_1.4s_ease_infinite]"
        )}
      />
      {children ?? described?.label}
    </span>
  );
};
