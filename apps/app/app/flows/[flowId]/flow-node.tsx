"use client";

import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  cn,
  LoaderCircle,
  TriangleAlert,
} from "@repo/design-system";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { createContext, type ReactNode, useContext } from "react";
import { asCategory, CategoryChip, categoryStyle } from "../node-visuals";
import type { CanvasNode } from "./flow-definition-mapping";
import { specsByType } from "./node-defaults";
import { summarizeNode } from "./node-summary";
import { outputsOf } from "./use-flow-editor";

/** The first validation issue of each node id, shown in the card's footer. */
export const NodeIssuesContext = createContext<ReadonlyMap<string, string>>(
  new Map()
);

export interface NodeRunOverlay {
  /** Items at this node in each status. */
  counts: Record<string, number>;
  status: string | null;
}

/** Run progress per node id. Absent in the builder, present in a run trace. */
export const RunOverlayContext = createContext<ReadonlyMap<
  string,
  NodeRunOverlay
> | null>(null);

type Outcome = "succeeded" | "failed" | "unknown" | "running" | "idle";

/** How a step went: unknown items outrank failures, which outrank success. */
export const outcomeOf = (overlay: NodeRunOverlay): Outcome => {
  if ((overlay.counts.UNKNOWN ?? 0) > 0) {
    return "unknown";
  }
  if ((overlay.counts.FAILED ?? 0) > 0 || overlay.status === "FAILED") {
    return "failed";
  }
  if (overlay.status === "RUNNING") {
    return "running";
  }
  return overlay.status === "SUCCEEDED" ? "succeeded" : "idle";
};

const OUTCOME_ICONS: Record<Outcome, ReactNode> = {
  failed: <CircleX className="text-(--status-danger-dot)" />,
  idle: <CircleDashed className="text-faint" />,
  running: <LoaderCircle className="animate-spin text-(--status-info-dot)" />,
  succeeded: <CircleCheck className="text-(--status-success-dot)" />,
  unknown: <CircleHelp className="text-(--status-unknown-bg)" />,
};

const OUTCOME_RINGS: Record<Outcome, string> = {
  failed: "[--node-ring:#e3a19b]",
  idle: "",
  running: "",
  succeeded: "",
  unknown:
    "shadow-[0_0_0_1px_var(--status-unknown-bg),0_0_0_4px_#ffe8d9,inset_3px_0_0_var(--cat)]",
};

const CountChip = ({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) => (
  <span
    className={cn(
      "inline-flex h-5 items-center rounded-full px-[7px] font-semibold text-[11px] leading-none",
      className
    )}
  >
    {children}
  </span>
);

/** Item counts of a step in a run: ✓ succeeded, ✗ failed, ? unknown. */
export const RunCountChips = ({
  counts,
}: {
  counts: Record<string, number>;
}) => {
  const running = (counts.PENDING ?? 0) + (counts.IN_PROGRESS ?? 0);
  return (
    <>
      {counts.SUCCEEDED ? (
        <CountChip className="bg-(--status-success-bg) text-(--status-success-fg)">
          {counts.SUCCEEDED.toLocaleString()} ✓
        </CountChip>
      ) : null}
      {counts.FAILED ? (
        <CountChip className="bg-(--status-danger-bg) text-(--status-danger-fg)">
          {counts.FAILED.toLocaleString()} ✗
        </CountChip>
      ) : null}
      {counts.UNKNOWN ? (
        <CountChip className="bg-(--status-unknown-bg) text-white">
          {counts.UNKNOWN.toLocaleString()} ?
        </CountChip>
      ) : null}
      {running > 0 ? (
        <CountChip className="bg-(--status-info-bg) text-(--status-info-fg)">
          {running.toLocaleString()} waiting
        </CountChip>
      ) : null}
    </>
  );
};

/** Spreads handles evenly down the right edge of the card. */
const handleOffset = (index: number, count: number) =>
  `${((index + 1) / (count + 1)) * 100}%`;

export function FlowNodeCard({ data, id, selected }: NodeProps<CanvasNode>) {
  const issue = useContext(NodeIssuesContext).get(id);
  const overlay = useContext(RunOverlayContext)?.get(id);
  const spec = specsByType.get(data.nodeType);
  const category = asCategory(spec?.category);
  const outputs = outputsOf(data.nodeType, data.config);
  const isTrigger = category === "trigger";
  const title = data.name || spec?.label || data.nodeType;
  const outcome = overlay ? outcomeOf(overlay) : null;

  const summary = summarizeNode(data.nodeType, data.config);

  return (
    <div
      className={cn(
        "relative w-[240px] rounded-card bg-card text-card-foreground shadow-[0_0_0_1px_var(--node-ring),0_1px_2px_rgba(22,23,26,0.05),inset_3px_0_0_var(--cat)] [--node-ring:var(--border)]",
        outcome && OUTCOME_RINGS[outcome],
        issue && !outcome && "[--node-ring:#e8c77c]",
        selected &&
          "shadow-[0_0_0_2px_var(--accent),0_0_0_6px_rgba(54,86,214,0.12),inset_3px_0_0_var(--cat)]"
      )}
      data-testid={`flow-node-${id}`}
      style={categoryStyle(category)}
    >
      {isTrigger ? null : (
        <Handle
          aria-label={`${title} input`}
          className="flow-handle flow-handle-in"
          position={Position.Left}
          type="target"
        />
      )}
      <div className="flex h-16 items-center gap-2.5 pr-3 pl-3.5">
        <CategoryChip category={category} nodeType={data.nodeType} size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-[550] text-[13px] leading-5">
            {title}
          </span>
          <span
            className={cn(
              "truncate text-[11px] tabular-nums leading-4",
              issue ? "text-(--status-warning-fg)" : "text-faint"
            )}
          >
            {issue ?? (summary || "Not configured yet")}
          </span>
        </div>
        {issue && !outcome ? (
          <TriangleAlert
            aria-hidden="true"
            className="size-3.5 shrink-0 text-(--status-warning-dot)"
          />
        ) : null}
        {outcome ? (
          <span
            className="shrink-0 [&_svg]:size-4"
            title={overlay?.status ?? ""}
          >
            {OUTCOME_ICONS[outcome]}
          </span>
        ) : null}
      </div>
      {overlay ? (
        <div className="flex min-h-[30px] flex-wrap gap-1 border-border border-t px-2.5 py-[7px]">
          <RunCountChips counts={overlay.counts} />
          {Object.values(overlay.counts).every((count) => !count) ? (
            <span className="text-[11.5px] text-muted-foreground">
              No items
            </span>
          ) : null}
        </div>
      ) : null}
      {outputs.map((output, index) => (
        <Handle
          aria-label={`${title} output ${output}`}
          className="flow-handle flow-handle-out"
          id={output}
          key={output}
          position={Position.Right}
          style={{ top: handleOffset(index, outputs.length) }}
          type="source"
        >
          {outputs.length > 1 ? (
            <span className="pointer-events-none absolute top-1/2 left-[14px] -translate-y-1/2 font-medium text-[10.5px] text-muted-foreground tabular-nums leading-none">
              {output}
            </span>
          ) : null}
        </Handle>
      ))}
    </div>
  );
}
