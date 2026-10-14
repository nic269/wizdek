import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleHelp,
  Eye,
  Info,
  Loader2,
  TriangleAlert,
} from "../icons";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";

export const LoadingState = ({ label = "Loading" }: { label?: string }) => (
  <div
    className="flex items-center gap-2 text-muted-foreground text-sm"
    role="status"
  >
    <Loader2 className="size-4 animate-spin" />
    <span>{label}</span>
  </div>
);

type AlertTone = "danger" | "warning" | "unknown" | "info" | "neutral";

const ALERT_CLASSES: Record<AlertTone, string> = {
  danger:
    "border-(--alert-danger-border) bg-(--alert-danger-bg) text-(--alert-danger-fg)",
  info: "border-[#c9d9f3] bg-(--status-info-bg) text-(--status-info-fg)",
  neutral: "border-border bg-sunken text-foreground-2",
  unknown:
    "border-(--alert-unknown-border) bg-(--alert-unknown-bg) text-(--alert-unknown-fg)",
  warning:
    "border-(--alert-warning-border) bg-(--alert-warning-bg) text-(--alert-warning-fg)",
};

const ALERT_ICONS: Record<AlertTone, ReactNode> = {
  danger: <CircleAlert />,
  info: <Info />,
  neutral: <Info />,
  unknown: <CircleHelp />,
  warning: <TriangleAlert />,
};

/** An inline alert: tinted box, icon, bold lead-in, text and an optional action. */
export const InlineAlert = ({
  tone = "danger",
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: AlertTone | undefined;
  title?: ReactNode | undefined;
  children?: ReactNode | undefined;
  action?: ReactNode | undefined;
  icon?: ReactNode | undefined;
  className?: string | undefined;
}) => (
  <div
    className={cn(
      "flex items-start gap-3 rounded-menu border px-3.5 py-3",
      ALERT_CLASSES[tone],
      className
    )}
    role={tone === "danger" ? "alert" : "status"}
  >
    <span className="mt-px shrink-0 [&_svg]:size-[17px]">
      {icon ?? ALERT_ICONS[tone]}
    </span>
    <div className="min-w-0 flex-1 text-[13.5px] leading-normal">
      {title ? <strong className="font-semibold">{title}</strong> : null}
      {title && children ? " " : null}
      {children}
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
);

/** A failed request: what failed, why, and a Retry button. */
export const ErrorAlert = ({
  title = "Something went wrong.",
  message,
  onRetry,
  className,
}: {
  title?: ReactNode | undefined;
  message?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
}) => (
  <InlineAlert
    action={
      onRetry ? (
        <Button
          className="text-(--alert-danger-fg) text-[12.5px]"
          onClick={onRetry}
          size="xs"
          type="button"
          variant="destructive"
        >
          Retry
        </Button>
      ) : undefined
    }
    className={className}
    title={title}
    tone="danger"
  >
    {message}
  </InlineAlert>
);

/** Kept for existing callers; renders an ErrorAlert without Retry. */
export const ErrorState = ({
  title = "Something went wrong.",
  message,
}: {
  title?: string | undefined;
  message?: string | undefined;
}) => <ErrorAlert message={message} title={title} />;

/**
 * Says what the viewer cannot do and which permission grants it, instead of
 * hiding actions silently.
 */
export const ReadOnlyBanner = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) => (
  <div
    className={cn(
      "flex items-center gap-2.5 rounded-menu border border-border bg-sunken px-3.5 py-2.5 text-[13px] text-foreground-2 leading-[1.45] [&_strong]:font-semibold",
      className
    )}
    role="note"
  >
    <Eye aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    <span className="flex-1">{children}</span>
  </div>
);

/** A shimmering placeholder bar. */
export const Shimmer = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={cn(
      "h-2.5 animate-[wz-shimmer_1.4s_linear_infinite] rounded bg-[length:800px_100%] bg-[linear-gradient(90deg,#efefec_0,#f7f7f5_50%,#efefec_100%)]",
      className
    )}
  />
);

/** A static placeholder bar for secondary cells. */
export const Placeholder = ({ className }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={cn("h-2.5 rounded bg-[#f0f0ed]", className)}
  />
);

/** Splits a grid template on spaces outside parentheses. */
const GRID_TRACK_SEPARATOR = /\s+(?![^(]*\))/;

/**
 * Loading rows for a list: the first column shimmers with a name and a meta
 * line, the rest show static bars. `columns` is the grid template of the list.
 */
export const SkeletonRows = ({
  columns,
  count = 4,
  rowHeight = 60,
  label = "Loading",
}: {
  columns: string;
  count?: number | undefined;
  rowHeight?: number | undefined;
  label?: string | undefined;
}) => {
  const cells = columns.trim().split(GRID_TRACK_SEPARATOR);
  return (
    <div aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: count }, (_, row) => `row-${row}`).map((rowKey) => (
        <div
          className="grid items-center gap-4 border-border border-b px-4 last:border-b-0"
          key={rowKey}
          style={{ gridTemplateColumns: columns, height: rowHeight }}
        >
          {cells.map((cell, index) =>
            index === 0 ? (
              <div className="flex flex-col gap-[7px]" key={`${cell}-first`}>
                <Shimmer className="w-1/2" />
                <Placeholder className="h-[9px] w-[70%] bg-[#f4f4f1]" />
              </div>
            ) : (
              <Placeholder
                className={
                  index === 2 ? "h-5 w-[90px] rounded-full" : "w-[60%]"
                }
                key={`${cell}-${index.toString()}`}
              />
            )
          )}
        </div>
      ))}
    </div>
  );
};
