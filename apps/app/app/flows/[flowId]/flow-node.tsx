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
