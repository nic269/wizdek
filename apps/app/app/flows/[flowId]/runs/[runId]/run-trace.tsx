"use client";

import "@xyflow/react/dist/style.css";
import "../../flow-builder.css";
import { apiClient, getApiErrorMessage } from "@repo/api/client";
import {
  ArrowLeft,
  Button,
  buttonVariants,
  CircleCheck,
  CircleHelp,
  CircleX,
  cn,
  EnvTag,
  ErrorAlert,
  Layers,
  ListTree,
  SegmentedControl,
  Shimmer,
  StatusBadge,
  toast,
  Workflow,
} from "@repo/design-system";
import { flowDefinitionSchema } from "@repo/flows/definition";
import { useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useMemo,
  useState,
} from "react";
import { formatDuration, formatWhen } from "../../../../lib/format";
import { isRunActive } from "../../../../lib/queries";
import {
  CANVAS_NODE_TYPE,
  type CanvasEdge,
  definitionToCanvas,
} from "../../flow-definition-mapping";
import {
  FlowNodeCard,
  type NodeRunOverlay,
  RunOverlayContext,
} from "../../flow-node";
import { type ItemFilter, RunItemsPanel } from "./run-items-panel";
import { RunTimeline } from "./run-timeline";
import type { RunTraceProps } from "./run-trace-loader";
import { errorText, orderSteps, sumOf, totalCounts } from "./trace-model";
import { type RunDetail, runQueryKey, useRunPolling } from "./use-run-polling";

const CANVAS_NODE_TYPES = { [CANVAS_NODE_TYPE]: FlowNodeCard };
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.12 };
const ITEM_FILTERS = new Set<ItemFilter>([
  "ALL",
  "UNKNOWN",
  "FAILED",
  "SUCCEEDED",
]);

type View = "timeline" | "canvas";

const EDGE_COLOURS = {
  branch: { border: "#bcd0f0", ink: "#1f4f99", stroke: "#3b7be0" },
  idle: { border: "var(--input)", ink: "#55554f", stroke: undefined },
  main: { border: "#bfe0cb", ink: "#1f6b3f", stroke: "#7fbf98" },
} as const;

/** An edge of the trace, coloured and labelled by the items that took it. */
const traceEdge = (edge: CanvasEdge, detail: RunDetail): CanvasEdge => {
  const handle = edge.sourceHandle ?? "main";
  const travelled = detail.nodes[edge.source]?.emitted[handle] ?? 0;
  let colours: (typeof EDGE_COLOURS)[keyof typeof EDGE_COLOURS] =
    EDGE_COLOURS.idle;
  if (travelled > 0) {
    colours =
      handle === "main" || handle === "false"
        ? EDGE_COLOURS.main
        : EDGE_COLOURS.branch;
  }
  return {
    ...edge,
    animated: isRunActive(detail.run.status) && travelled > 0,
    ...(handle === "false" ? { className: "edge-false" } : {}),
    label: handle === "main" ? String(travelled) : `${travelled} ${handle}`,
    labelBgPadding: [7, 4],
    labelBgStyle: { stroke: colours.border },
    labelStyle: { fill: colours.ink },
    ...(colours.stroke
      ? { style: { stroke: colours.stroke, strokeWidth: 2 } }
      : {}),
  };
};

/**
 * The run's own version of the flow as a read-only canvas. Each edge is
 * labelled with the number of items that travelled along it.
 */
const useTraceCanvas = (detail: RunDetail | undefined) =>
  useMemo(() => {
    const parsed = flowDefinitionSchema.safeParse(detail?.version.definition);
    if (!(detail && parsed.success)) {
      return { definition: null, edges: [], nodes: [] };
    }
    const canvas = definitionToCanvas(parsed.data);
    return {
      definition: parsed.data,
      edges: canvas.edges.map((edge) => traceEdge(edge, detail)),
      nodes: canvas.nodes,
    };
  }, [detail]);

const SummaryTile = ({
  active,
  className,
  count,
  icon,
  label,
  onPick,
}: {
  active: boolean;
  className: string;
  count: number;
  icon: ReactNode;
  label: string;
  onPick: () => void;
}) => (
  <Button
    aria-pressed={active}
    className={cn(
      "h-auto justify-start gap-2.5 rounded-menu px-3 py-2.5 text-left [&_svg:not([class*='size-'])]:size-[17px]",
      className,
      active && "ring-3 ring-accent-soft"
    )}
    onClick={onPick}
    variant="outline"
  >
    {icon}
    <span className="flex-1">
      <span className="block font-semibold text-[19px] leading-[1.1] tracking-[-0.01em]">
        {count.toLocaleString()}
      </span>
      <span className="block font-medium text-xs leading-[1.3] opacity-85">
        {label}
      </span>
    </span>
  </Button>
);

const TraceSkeleton = () => (
  <div className="flex flex-1 flex-col gap-3 p-5" role="status">
    <span className="sr-only">Loading run</span>
    <Shimmer className="w-48" />
    <Shimmer className="h-16 w-full" />
    <Shimmer className="h-40 w-full" />
  </div>
);

const TraceTitleBar = ({
  canRun,
  detail,
  flowId,
  onViewChange,
  runId,
  view,
}: {
  canRun: boolean;
  detail: RunDetail;
  flowId: string;
  onViewChange: (view: View) => void;
  runId: string;
  view: View;
}) => {
  const queryClient = useQueryClient();
  const [isCanceling, setIsCanceling] = useState(false);
  const { run } = detail;
  const active = isRunActive(run.status);
  const cancelRequested = Boolean(run.cancelRequestedAt);
  const setView = onViewChange;

  const cancel = async () => {
    setIsCanceling(true);
    try {
      await apiClient.flows.runs.cancel({ runId });
      toast.info("Canceling the run", {
        description: "The item in progress finishes; the rest stay pending.",
      });
      await queryClient.invalidateQueries({ queryKey: runQueryKey(runId) });
    } catch (cause) {
      toast.error("Could not cancel the run", {
        description: getApiErrorMessage(cause, "Try again."),
      });
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Link
        className="inline-flex items-center gap-[5px] font-medium text-[13px] text-muted-foreground hover:text-foreground"
        href={`/flows/${flowId}/runs`}
      >
        <ArrowLeft className="size-3.5" />
        Runs
      </Link>
      <span aria-hidden="true" className="text-input">
        /
      </span>
      <h1 className="font-semibold text-[19px] leading-[1.2] tracking-[-0.015em]">
        Run #{run.number}
      </h1>
      <span data-testid="run-status">
        <StatusBadge status={run.status} />
      </span>
      <span className="flex-1" />
      <SegmentedControl
        aria-label="View"
        onValueChange={setView}
        options={[
          { icon: <ListTree />, label: "Timeline", value: "timeline" },
          { icon: <Workflow />, label: "On canvas", value: "canvas" },
        ]}
        value={view}
      />
      <Link
        className={buttonVariants({ variant: "outline" })}
        href={`/flows/${flowId}`}
      >
        Open flow
      </Link>
      {canRun && active ? (
        <Button
          disabled={isCanceling || cancelRequested}
          onClick={cancel}
          type="button"
          variant="destructive"
        >
          {cancelRequested ? "Canceling…" : "Cancel run"}
        </Button>
      ) : null}
    </div>
  );
};

const TraceMeta = ({ detail }: { detail: RunDetail }) => {
  const { run } = detail;
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-[12.5px] text-muted-foreground leading-[1.4]">
      <span className="font-medium text-foreground-2">
        {detail.flowName} · v{detail.version.version}
      </span>
      <span className="inline-flex items-center gap-1.5">
        on{" "}
        <strong className="font-semibold text-foreground">
          {detail.store.name}
        </strong>
        <EnvTag environment={detail.store.environment} />
      </span>
      <span>
        {detail.startedByName
          ? `Started by ${detail.startedByName}`
          : "Started automatically"}{" "}
        · {formatWhen(run.startedAt ?? run.createdAt)}
      </span>
      <span>
        Duration{" "}
        <span className="font-mono text-foreground-2">
          {run.startedAt ? formatDuration(run.startedAt, run.completedAt) : "—"}
        </span>
      </span>
    </div>
  );
};

const SummaryTiles = ({
  filter,
  onPick,
  selectedStep,
  totals,
}: {
  filter: ItemFilter;
  onPick: (filter: ItemFilter) => void;
  selectedStep: string | null;
  totals: Record<string, number>;
}) => {
  const pickFilter = onPick;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
      <SummaryTile
        active={filter === "ALL" && !selectedStep}
        className="border-border bg-card text-foreground"
        count={sumOf(totals)}
        icon={<Layers />}
        label="items processed"
        onPick={() => pickFilter("ALL")}
      />
      <SummaryTile
        active={filter === "SUCCEEDED"}
        className="border-[#cfe7d7] bg-[#f3faf5] text-(--status-success-fg) hover:bg-[#eaf6ee]"
        count={totals.SUCCEEDED ?? 0}
        icon={<CircleCheck />}
        label="succeeded"
        onPick={() => pickFilter("SUCCEEDED")}
      />
      <SummaryTile
        active={filter === "FAILED"}
        className="border-(--alert-danger-border) bg-[#fdf5f4] text-(--status-danger-fg) hover:bg-(--alert-danger-bg)"
        count={totals.FAILED ?? 0}
        icon={<CircleX />}
        label="failed · see errors"
        onPick={() => pickFilter("FAILED")}
      />
      <SummaryTile
        active={filter === "UNKNOWN"}
        className="border-(--status-unknown-bg) bg-(--status-unknown-bg) text-white hover:bg-(--status-unknown-bg)/90 hover:text-white"
        count={totals.UNKNOWN ?? 0}
        icon={<CircleHelp />}
        label="unknown · check in Shopify"
        onPick={() => pickFilter("UNKNOWN")}
      />
    </div>
  );
};

const TraceCanvas = ({
  canvas,
  onSelectStep,
  selectedStep,
}: {
  canvas: ReturnType<typeof useTraceCanvas>;
  onSelectStep: Dispatch<SetStateAction<string | null>>;
  selectedStep: string | null;
}) => {
  const setSelectedStep = onSelectStep;
  return (
    <div className="flow-canvas h-full min-h-[480px]">
      <ReactFlow
        deleteKeyCode={null}
        edges={canvas.edges}
        edgesFocusable={false}
        elementsSelectable
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.15}
        nodes={canvas.nodes.map((node) => ({
          ...node,
          selected: node.id === selectedStep,
        }))}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable
        nodeTypes={CANVAS_NODE_TYPES}
        onNodeClick={(_event, node) =>
          setSelectedStep((current) => (current === node.id ? null : node.id))
        }
        onPaneClick={() => setSelectedStep(null)}
      >
        <Background
          color="var(--input)"
          gap={18}
          size={1.2}
          variant={BackgroundVariant.Dots}
        />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

function Trace({ canRun, flowId, runId }: RunTraceProps) {
  const query = useRunPolling(runId);
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("status") as ItemFilter | null;
  const [view, setView] = useState<View>("timeline");
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [filter, setFilter] = useState<ItemFilter>(
    initialFilter && ITEM_FILTERS.has(initialFilter) ? initialFilter : "ALL"
  );
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
    return <TraceSkeleton />;
  }
  if (query.isError || !detail || !canvas.definition) {
    return (
      <div className="p-8">
        <ErrorAlert
          message={getApiErrorMessage(
            query.error,
            "The run could not be read."
          )}
          onRetry={() => query.refetch()}
          title="Couldn't load the run."
        />
      </div>
    );
  }

  const { run } = detail;
  const active = isRunActive(run.status);
  const steps = orderSteps(canvas.definition);
  const stepNames = new Map(
    steps.map((node) => [node.id, node.name || node.type])
  );
  const totals = totalCounts(detail.nodes);
  const scopedCounts = selectedStep
    ? (detail.nodes[selectedStep]?.counts ?? {})
    : totals;
  const stopped = errorText(run.error);

  const pickFilter = (next: ItemFilter) => {
    setFilter(next);
    setSelectedStep(null);
  };

  return (
    <RunOverlayContext.Provider value={overlays}>
      <div className="flex min-h-[640px] flex-1 flex-col">
        <div className="flex flex-col gap-3 border-border border-b px-5 pt-4 pb-3.5">
          <TraceTitleBar
            canRun={canRun}
            detail={detail}
            flowId={flowId}
            onViewChange={setView}
            runId={runId}
            view={view}
          />
          <TraceMeta detail={detail} />
          <SummaryTiles
            filter={filter}
            onPick={pickFilter}
            selectedStep={selectedStep}
            totals={totals}
          />
          {stopped ? (
            <ErrorAlert message={stopped} title="The run stopped." />
          ) : null}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(340px,38%)]">
          <div className="min-h-0 min-w-0 overflow-auto border-border border-r">
            {view === "timeline" ? (
              <RunTimeline
                nodes={detail.nodes}
                onSelectStep={setSelectedStep}
                selectedStep={selectedStep}
                steps={steps}
              />
            ) : (
              <TraceCanvas
                canvas={canvas}
                onSelectStep={setSelectedStep}
                selectedStep={selectedStep}
              />
            )}
          </div>
          <RunItemsPanel
            counts={scopedCounts}
            filter={filter}
            isRunActive={active}
            onFilterChange={setFilter}
            runId={runId}
            selectedStep={selectedStep}
            shopDomain={detail.store.shopDomain}
            stepNames={stepNames}
          />
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
