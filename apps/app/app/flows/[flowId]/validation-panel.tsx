"use client";

import { Button } from "@repo/design-system";
import type { FlowIssue } from "@repo/flows/definition";

export function ValidationPanel({
  issues,
  nodeNames,
  onSelectNode,
}: {
  issues: FlowIssue[];
  nodeNames: ReadonlyMap<string, string>;
  onSelectNode: (nodeId: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <p
        className="text-emerald-700 text-sm dark:text-emerald-400"
        role="status"
      >
        No problems found. The flow can run.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="font-medium text-sm" role="status">
        {issues.length} problem{issues.length === 1 ? "" : "s"} to fix before
        the flow can run
      </p>
      <ul
        aria-label="Validation issues"
        className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm"
      >
        {issues.map((issue) => (
          <li
            className="flex items-start justify-between gap-3 px-3 py-1.5"
            key={`${issue.code}-${issue.nodeId ?? ""}-${issue.edgeId ?? ""}-${issue.path ?? ""}-${issue.message}`}
          >
            <span>
              {issue.nodeId ? (
                <span className="font-medium">
                  {nodeNames.get(issue.nodeId) ?? issue.nodeId}:{" "}
                </span>
              ) : null}
              {issue.message}
            </span>
            {issue.nodeId ? (
              <Button
                className="h-auto shrink-0 p-0 text-muted-foreground text-xs"
                onClick={() => onSelectNode(issue.nodeId as string)}
                type="button"
                variant="link"
              >
                Show
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
