"use client";

import { cn } from "@repo/design-system";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { createContext, useContext } from "react";
import type { CanvasNode } from "./flow-definition-mapping";
import { specsByType } from "./node-defaults";
import { outputsOf } from "./use-flow-editor";

/** Number of validation issues per node id, shown as a badge on the card. */
export const NodeIssuesContext = createContext<ReadonlyMap<string, number>>(
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

const STEP_STATUS_LABELS: Record<string, string> = {
  FAILED: "Failed",
  PENDING: "Waiting",
  RUNNING: "Running",
  SKIPPED: "Skipped",
  SUCCEEDED: "Done",
};

const STEP_STATUS_STYLES: Record<string, string> = {
  FAILED: "bg-destructive text-white",
  RUNNING: "bg-sky-600 text-white",
  SUCCEEDED: "bg-emerald-600 text-white",
};

const total = (counts: Record<string, number>) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

function RunOverlay({ overlay }: { overlay: NodeRunOverlay }) {
  const status = overlay.status ?? "PENDING";
  const troubled = (overlay.counts.FAILED ?? 0) + (overlay.counts.UNKNOWN ?? 0);
  return (
    <div className="mt-2 space-y-1 border-t pt-2 text-[11px]">
      <span
        className={cn(
          "inline-block rounded px-1.5 py-0.5 font-medium",
          STEP_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
        )}
      >
        {STEP_STATUS_LABELS[status] ?? status}
      </span>
      <p className="text-muted-foreground">
        {total(overlay.counts)} in · {overlay.counts.SUCCEEDED ?? 0} ok
        {troubled > 0 ? (
          <span className="font-medium text-destructive">
            {" "}
            · {overlay.counts.FAILED ?? 0} failed
            {overlay.counts.UNKNOWN
              ? ` · ${overlay.counts.UNKNOWN} unknown`
              : ""}
          </span>
        ) : null}
      </p>
    </div>
  );
}

const CATEGORY_STYLES: Record<string, string> = {
  action: "border-l-emerald-500",
  data: "border-l-sky-500",
  logic: "border-l-amber-500",
  trigger: "border-l-violet-500",
};

const HANDLE_CLASS =
  "!h-3 !w-3 !border-2 !border-background !bg-foreground focus-visible:!ring-2 focus-visible:!ring-ring";

/** Spreads handles evenly down the right edge of the card. */
const handleOffset = (index: number, count: number) =>
  `${((index + 1) / (count + 1)) * 100}%`;

export function FlowNodeCard({ data, id, selected }: NodeProps<CanvasNode>) {
  const issueCount = useContext(NodeIssuesContext).get(id) ?? 0;
  const overlay = useContext(RunOverlayContext)?.get(id);
  const spec = specsByType.get(data.nodeType);
  const outputs = outputsOf(data.nodeType, data.config);
  const isTrigger = spec?.category === "trigger";
  const title = data.name || spec?.label || data.nodeType;

  return (
    <div
      className={cn(
        "min-w-44 max-w-60 rounded-md border border-l-4 bg-card px-3 py-2 text-card-foreground shadow-sm",
        CATEGORY_STYLES[spec?.category ?? ""] ?? "border-l-muted-foreground",
        selected && "ring-2 ring-ring",
        issueCount > 0 && "border-destructive"
      )}
      data-testid={`flow-node-${id}`}
    >
      {isTrigger ? null : (
        <Handle
          aria-label={`${title} input`}
          className={HANDLE_CLASS}
          position={Position.Left}
          type="target"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">{title}</p>
          <p className="truncate text-muted-foreground text-xs">
            {spec?.label ?? "Unknown node type"}
          </p>
        </div>
        {issueCount > 0 ? (
          <span
            className="shrink-0 rounded-full bg-destructive px-1.5 font-medium text-[10px] text-white"
            title={`${issueCount} issue${issueCount === 1 ? "" : "s"}`}
          >
            {issueCount}
          </span>
        ) : null}
      </div>
      {outputs.length > 1 ? (
        <div className="mt-2 flex flex-col items-end gap-1 text-[10px] text-muted-foreground">
          {outputs.map((output) => (
            <span key={output}>{output}</span>
          ))}
        </div>
      ) : null}
      {overlay ? <RunOverlay overlay={overlay} /> : null}
      {outputs.map((output, index) => (
        <Handle
          aria-label={`${title} output ${output}`}
          className={HANDLE_CLASS}
          id={output}
          key={output}
          position={Position.Right}
          style={
            outputs.length > 1
              ? { top: handleOffset(index, outputs.length) }
              : undefined
          }
          type="source"
        />
      ))}
    </div>
  );
}
