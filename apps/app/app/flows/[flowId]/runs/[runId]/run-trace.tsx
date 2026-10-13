"use client";

import "@xyflow/react/dist/style.css";
import "../../flow-builder.css";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  Button,
  buttonVariants,
  ErrorState,
  LoadingState,
} from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
import { flowDefinitionSchema } from "@repo/flows/definition";
import { useQueryClient } from "@tanstack/react-query";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import { useAppTheme } from "../../../../lib/use-app-theme";
import {
  formatDateTime,
  formatDuration,
  formatItemCounts,
  isRunActive,
  RUN_STATUS_LABELS,
  RUN_STATUS_VARIANTS,
} from "../../../flow-labels";
import {
  CANVAS_NODE_TYPE,
  definitionToCanvas,
} from "../../flow-definition-mapping";
import {
  FlowNodeCard,
  type NodeRunOverlay,
  RunOverlayContext,
} from "../../flow-node";
import { RunItemsPanel } from "./run-items-panel";
import type { RunTraceProps } from "./run-trace-loader";
import { type RunDetail, runQueryKey, useRunPolling } from "./use-run-polling";

const CANVAS_NODE_TYPES = { [CANVAS_NODE_TYPE]: FlowNodeCard };
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.15 };
const MIN_ZOOM = 0.15;

const errorMessage = (error: unknown): string | null =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : null;

/** Adds every node's item counts together for the run's summary line. */
const totalCounts = (nodes: RunDetail["nodes"]) => {
  const totals: Record<string, number> = {};
  for (const { counts } of Object.values(nodes)) {
    for (const [status, count] of Object.entries(counts)) {
      totals[status] = (totals[status] ?? 0) + count;
    }
  }
  return totals;
};

/**
 * The run's own version of the flow as a read-only canvas. Each edge is
 * labelled with the number of items that travelled along it.
 */
const useTraceCanvas = (detail: RunDetail | undefined) =>
  useMemo(() => {
    const parsed = flowDefinitionSchema.safeParse(detail?.version.definition);
    if (!(detail && parsed.success)) {
      return { edges: [], names: new Map<string, string>(), nodes: [] };
    }
    const canvas = definitionToCanvas(parsed.data);
    return {
      edges: canvas.edges.map((edge) => {
        const travelled =
          detail.nodes[edge.source]?.emitted[edge.sourceHandle ?? "main"] ?? 0;
        return {
          ...edge,
          animated: isRunActive(detail.run.status) && travelled > 0,
          label: String(travelled),
        };
      }),
      names: new Map(
        canvas.nodes.map((node) => [
          node.id,
          node.data.name || node.data.nodeType,
        ])
      ),
      nodes: canvas.nodes,
    };
  }, [detail]);

function Trace({ canRun, flowId, flowName, runId }: RunTraceProps) {
  const query = useRunPolling(runId);
  const queryClient = useQueryClient();
  const theme = useAppTheme();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);
  const detail = query.data;
  const canvas = useTraceCanvas(detail);

  const overlays = useMemo(() => {
    const map = new Map<string, NodeRunOverlay>();
    for (const node of canvas.nodes) {
      const summary = detail?.nodes[node.id];
      map.set(node.id, {
        counts: summary?.counts ?? {},
        status: summary?.step?.status ?? null,
      });
    }
    return map;
  }, [canvas.nodes, detail]);

  if (query.isPending) {
    return <LoadingState label="Loading run" />;
  }
  if (query.isError || !detail) {
    return (
      <ErrorState
        message={getApiErrorMessage(query.error, "Could not load the run.")}
      />
    );
  }

  const { run } = detail;
  const active = isRunActive(run.status);
  const cancelRequested = Boolean(run.cancelRequestedAt);

  const cancel = async () => {
    setActionError(null);
    setIsCanceling(true);
    try {
      await apiClient.flows.runs.cancel({ runId });
      await queryClient.invalidateQueries({ queryKey: runQueryKey(runId) });
    } catch (cause) {
      setActionError(getApiErrorMessage(cause, "Could not cancel the run."));
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <RunOverlayContext.Provider value={overlays}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <a
              className="text-muted-foreground text-sm hover:underline"
              href={`/flows/${flowId}/runs`}
            >
              Runs
            </a>
            <h1 className="truncate font-semibold text-xl">{flowName}</h1>
            <Badge
              data-testid="run-status"
              variant={RUN_STATUS_VARIANTS[run.status]}
            >
              {RUN_STATUS_LABELS[run.status]}
            </Badge>
            <span className="text-muted-foreground text-xs">
              Version {detail.version.version} ·{" "}
              {formatDateTime(run.startedAt ?? run.createdAt)} ·{" "}
              {formatDuration(run.startedAt, run.completedAt)} ·{" "}
              {formatItemCounts(totalCounts(detail.nodes))}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/flows/${flowId}`}
            >
              Open flow
            </a>
            {canRun && active ? (
              <Button
                disabled={isCanceling || cancelRequested}
                onClick={cancel}
                type="button"
                variant="destructive"
              >
                {cancelRequested ? "Canceling..." : "Cancel run"}
              </Button>
            ) : null}
          </div>
        </div>

        {actionError ? <ErrorState message={actionError} /> : null}
        {errorMessage(run.error) ? (
          <ErrorState
            message={errorMessage(run.error) ?? ""}
            title="The run stopped"
          />
        ) : null}

        <div className="flow-builder grid grid-cols-[1fr_22rem] overflow-hidden rounded-md border">
          <div className="h-full">
            <ReactFlow
              colorMode={theme}
              deleteKeyCode={null}
              edges={canvas.edges}
              edgesFocusable={false}
              elementsSelectable
              fitView
              fitViewOptions={FIT_VIEW_OPTIONS}
              minZoom={MIN_ZOOM}
              nodes={canvas.nodes.map((node) => ({
                ...node,
                selected: node.id === selectedNodeId,
              }))}
              nodesConnectable={false}
              nodesDraggable={false}
              nodesFocusable
              nodeTypes={CANVAS_NODE_TYPES}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="border-l">
            {selectedNodeId ? (
              <RunItemsPanel
                isRunActive={active}
                key={selectedNodeId}
                nodeId={selectedNodeId}
                nodeName={canvas.names.get(selectedNodeId) ?? selectedNodeId}
                runId={runId}
              />
            ) : (
              <p className="p-4 text-muted-foreground text-sm">
                Select a step to see the items it received, what each one
                produced, and why any of them failed.
              </p>
            )}
          </div>
        </div>
      </div>
    </RunOverlayContext.Provider>
  );
}

export function RunTrace(props: RunTraceProps) {
  return (
    <ReactFlowProvider>
      <Trace {...props} />
    </ReactFlowProvider>
  );
}
