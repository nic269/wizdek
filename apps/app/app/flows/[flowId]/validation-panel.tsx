"use client";

import {
  ArrowRight,
  Button,
  CircleCheck,
  TriangleAlert,
  X,
} from "@repo/design-system";
import type { FlowIssue } from "@repo/flows/definition";
import { asCategory, CategoryChip } from "../node-visuals";
import { specsByType } from "./node-defaults";

/** An issue's message without the config path the server prefixes it with. */
export const issueText = (issue: FlowIssue) =>
  issue.path && issue.message.startsWith(`${issue.path}: `)
    ? issue.message.slice(issue.path.length + 2)
    : issue.message;

/**
 * The validation popover over the bottom-left of the canvas. Choosing an
 * issue selects its step.
 */
export function ValidationPopover({
  issues,
  nodes,
  onClose,
  onSelectNode,
}: {
  issues: FlowIssue[];
  /** Name and type of each step, by node id. */
  nodes: ReadonlyMap<string, { name: string; nodeType: string }>;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const count = issues.length;
  return (
    <section
      aria-label="Validation"
      className="fade-in-0 slide-in-from-bottom-2 absolute bottom-3.5 left-4 z-10 w-[330px] animate-in overflow-hidden rounded-card border border-border bg-card shadow-popover duration-150"
    >
      <div className="flex items-center gap-2 border-border border-b px-3.5 py-[11px]">
        {count > 0 ? (
          <TriangleAlert className="size-[15px] text-(--status-warning-dot)" />
        ) : (
          <CircleCheck className="size-[15px] text-(--status-success-dot)" />
        )}
        <h2
          className="flex-1 font-semibold text-[13px] leading-none"
          role="status"
        >
          {count > 0
            ? `${count} issue${count === 1 ? "" : "s"} to fix before running`
            : "No issues — ready to run"}
        </h2>
        <Button
          aria-label="Close validation"
          className="size-6 text-muted-foreground"
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {count > 0 ? (
        <ul aria-label="Validation issues" className="max-h-64 overflow-y-auto">
          {issues.map((issue) => {
            const node = issue.nodeId ? nodes.get(issue.nodeId) : undefined;
            const category = asCategory(
              node ? specsByType.get(node.nodeType)?.category : undefined
            );
            return (
              <li
                key={`${issue.code}-${issue.nodeId ?? ""}-${issue.edgeId ?? ""}-${issue.path ?? ""}-${issue.message}`}
              >
                <Button
                  className="h-auto w-full items-start justify-start gap-2.5 rounded-none px-3.5 py-[11px] text-left font-normal"
                  disabled={!issue.nodeId}
                  onClick={() => issue.nodeId && onSelectNode(issue.nodeId)}
                  variant="ghost"
                >
                  {node ? (
                    <CategoryChip
                      category={category}
                      nodeType={node.nodeType}
                      size={22}
                    />
                  ) : (
                    <span className="size-[22px]" />
                  )}
                  <span className="min-w-0 flex-1 whitespace-normal">
                    <span className="block font-semibold text-[12.5px] leading-[1.3]">
                      {node?.name ?? "Flow"}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground leading-[1.4]">
                      {issueText(issue)}
                    </span>
                  </span>
                  {issue.nodeId ? (
                    <ArrowRight className="mt-1 size-[13px] text-muted-foreground" />
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
