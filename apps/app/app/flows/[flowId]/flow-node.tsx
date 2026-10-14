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
import {
  asCategory,
  CATEGORY_LABELS,
  CategoryChip,
  categoryStyle,
} from "../node-visuals";
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

const OUTCOME_BORDERS: Record<Outcome, string> = {
  failed: "border-[#e3a19b]",
  idle: "border-input",
  running: "border-input",
  succeeded: "border-input",
  unknown: "border-(--status-unknown-bg) shadow-[0_0_0_3px_#ffe8d9]",
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

const Footer = ({
  issue,
  summary,
}: {
  issue: string | undefined;
  summary: string;
}) => {
  if (issue) {
    return (
      <div className="flex min-h-[30px] items-center gap-1.5 rounded-b-[9px] border-border border-t bg-(--alert-warning-bg) px-3 py-[7px] text-(--status-warning-fg) text-[11.5px] leading-[1.3]">
        <TriangleAlert className="size-3 shrink-0" />
        <span className="truncate">{issue}</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-[30px] items-center gap-1.5 border-border border-t px-3 py-[7px] text-[11.5px] text-muted-foreground leading-[1.3]">
      {summary ? (
        <CircleCheck className="size-3 shrink-0" />
      ) : (
        <CircleDashed className="size-3 shrink-0" />
      )}
      <span className="truncate">{summary || "Not configured yet"}</span>
    </div>
  );
};

export function FlowNodeCard({ data, id, selected }: NodeProps<CanvasNode>) {
  const issue = useContext(NodeIssuesContext).get(id);
  const overlay = useContext(RunOverlayContext)?.get(id);
  const spec = specsByType.get(data.nodeType);
  const category = asCategory(spec?.category);
  const outputs = outputsOf(data.nodeType, data.config);
  const isTrigger = category === "trigger";
  const title = data.name || spec?.label || data.nodeType;
  const outcome = overlay ? outcomeOf(overlay) : null;

  return (
    <div
      className={cn(
        "relative w-[216px] rounded-card border bg-card text-card-foreground shadow-node",
        outcome ? OUTCOME_BORDERS[outcome] : "border-input",
        issue && !outcome && "border-[#e8c77c]",
        selected &&
          "border-accent shadow-[0_0_0_3px_var(--accent-soft),0_6px_18px_-6px_rgba(0,0,0,.15)]"
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
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <CategoryChip category={category} nodeType={data.nodeType} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 font-mono font-semibold text-(--cat) text-[9.5px] uppercase leading-none tracking-[0.07em]">
            {CATEGORY_LABELS[category]}
          </div>
          <div className="truncate font-semibold text-[13.5px] leading-[1.2]">
            {title}
          </div>
        </div>
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
      ) : (
        <Footer
          issue={issue}
          summary={summarizeNode(data.nodeType, data.config)}
        />
      )}
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
            <span className="pointer-events-none absolute top-1/2 left-[14px] -translate-y-1/2 font-medium font-mono text-[10.5px] text-muted-foreground leading-none">
              {output}
            </span>
          ) : null}
        </Handle>
      ))}
    </div>
  );
}
