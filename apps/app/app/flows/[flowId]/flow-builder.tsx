"use client";

import "@xyflow/react/dist/style.css";
import "./flow-builder.css";
import {
  ArrowLeft,
  Button,
  cn,
  ErrorAlert,
  History,
  ListChecks,
  Lock,
  Play,
  Shimmer,
  StatusBadge,
  toast,
} from "@repo/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import type { FlowDefinition } from "@repo/flows/definition";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import Link from "next/link";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ActivationPanel } from "./activation-panel";
import type { FlowBuilderProps } from "./flow-builder-loader";
import { CANVAS_NODE_TYPE } from "./flow-definition-mapping";
import { FlowNodeCard, NodeIssuesContext } from "./flow-node";
import { NodeConfigPanel, NothingSelected } from "./node-config-panel";
import { specsByType } from "./node-defaults";
import { NodePalette, PALETTE_DRAG_TYPE } from "./node-palette";
import { RunDialog, type RunInput } from "./run-dialog";
import { type Flow, type FlowEditor, useFlowEditor } from "./use-flow-editor";
import { issueText, ValidationPopover } from "./validation-panel";
import { VersionHistory } from "./version-history";

const CANVAS_NODE_TYPES = { [CANVAS_NODE_TYPE]: FlowNodeCard };
const DELETE_KEYS = ["Backspace", "Delete"];
/** Horizontal distance between steps added by clicking the palette. */
const NODE_SPACING = 270;
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.15 };
/** Low enough that a long flow still fits a narrow canvas when framed. */
const MIN_ZOOM = 0.15;

/** Why the Run button is disabled, shown as its tooltip. */
const runBlockedReason = (isDirty: boolean, issueCount: number) => {
  if (isDirty) {
    return "Save your changes before running the flow.";
  }
  return issueCount > 0
    ? "Fix the flow's problems before running it."
    : undefined;
};

/** The inputs the manual trigger asks for when a run starts. */
const triggerInputs = (definition: FlowDefinition): RunInput[] => {
  const trigger = definition.nodes.find(
    (node) => node.type === "trigger.manual"
  );
  const inputs = trigger?.config.inputs;
  return Array.isArray(inputs) ? (inputs as RunInput[]) : [];
};

/** Labels of the steps that write to the store. */
const actionLabels = (definition: FlowDefinition) => [
  ...new Set(
    definition.nodes
      .filter(
        // Find order only reads; every other action can change the store.
        (node) =>
          specsByType.get(node.type)?.category === "action" &&
          node.type !== "shopify.findOrder"
      )
      .map((node) => specsByType.get(node.type)?.label ?? node.type)
  ),
];

function BuilderHeader({
  canManage,
  canRun,
  editor,
  flow,
  onActivate,
  onRun,
  onSave,
  onToggleValidation,
  showValidation,
}: {
  canManage: boolean;
  canRun: boolean;
  editor: FlowEditor;
  flow: Flow;
  onActivate: () => void;
  onRun: () => void;
  onSave: () => void;
  onToggleValidation: () => void;
  showValidation: boolean;
}) {
  const { isDirty } = editor;
  const triggerType = editor.definition.nodes.find((node) =>
    node.type.startsWith("trigger.")
  )?.type;
  const startsManually = triggerType === "trigger.manual";
  const startsAutomatically =
    triggerType === "trigger.webhook" || triggerType === "trigger.schedule";
  const issueCount = editor.issues.length;

  return (
    <div className="flex flex-wrap items-center gap-3 border-border border-b px-3.5 py-2.5">
      <Link
        className="inline-flex items-center gap-[5px] px-1 py-1.5 font-medium text-[13px] text-muted-foreground hover:text-foreground"
        href="/flows"
      >
        <ArrowLeft className="size-3.5" />
        Flows
      </Link>
      <span aria-hidden="true" className="text-input">
        /
      </span>
      <h1 className="truncate font-semibold text-[15px] leading-none tracking-[-0.01em]">
        {flow.name}
      </h1>
      <StatusBadge status={flow.status} />
      {canManage ? null : (
        <span className="inline-flex h-[22px] items-center gap-[5px] rounded-full border border-input px-2 font-medium text-foreground-2 text-xs">
          <Lock className="size-[11px]" />
          Read-only
        </span>
      )}
      <VersionHistory
        flowId={flow.id}
        isDirty={isDirty}
        savedAt={editor.savedAt}
        version={editor.version}
      />
      <div className="flex-1" />
      <Button
        aria-pressed={showValidation}
        className={cn(
          "h-8 px-[11px] text-[13px]",
          showValidation && "bg-hover"
        )}
        onClick={onToggleValidation}
        type="button"
        variant="ghost"
      >
        <ListChecks />
        Validate
        {issueCount > 0 ? (
          <span className="min-w-[18px] rounded-full bg-(--status-warning-bg) px-[5px] text-center font-semibold text-(--status-warning-fg) text-[11px] leading-[18px]">
            {issueCount}
          </span>
        ) : null}
      </Button>
      <Link
        className="inline-flex h-8 items-center gap-[7px] rounded-lg px-[11px] font-medium text-[13px] hover:bg-hover"
        href={`/flows/${flow.id}/runs`}
      >
        <History className="size-[15px]" />
        Runs
      </Link>
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      {canManage ? (
        <Button
          aria-keyshortcuts="Meta+S"
          aria-label={editor.isSaving ? "Saving" : "Save"}
          className={cn("h-8 text-[13px]", !isDirty && "text-muted-foreground")}
          disabled={editor.isSaving || !isDirty}
          onClick={onSave}
          type="button"
          variant="outline"
        >
          {editor.isSaving ? "Saving…" : "Save"}
          <kbd className="font-medium font-mono text-[10.5px] text-muted-foreground">
            ⌘S
          </kbd>
        </Button>
      ) : null}
      {canRun && startsManually ? (
        <Button
          className="h-8 text-[13px]"
          disabled={isDirty || issueCount > 0}
          onClick={onRun}
          title={runBlockedReason(isDirty, issueCount)}
          type="button"
        >
          <Play className="size-[13px]" />
          Run…
        </Button>
      ) : null}
      {startsAutomatically ? (
        <Button
          className="h-8 text-[13px]"
          onClick={onActivate}
          type="button"
          variant={canManage ? "default" : "outline"}
        >
          <Play className="size-[13px]" />
          Activation…
        </Button>
      ) : null}
    </div>
  );
}

const BuilderSkeleton = () => (
  <div className="flex flex-1 flex-col" role="status">
    <span className="sr-only">Loading flow</span>
    <div className="flex items-center gap-3 border-border border-b px-3.5 py-3.5">
      <Shimmer className="w-40" />
      <Shimmer className="w-20" />
    </div>
    <div className="flex-1 bg-sunken" />
  </div>
);

function Builder({ canManage, canRun, flowId }: FlowBuilderProps) {
  const editor = useFlowEditor(flowId, canManage);
  const { addNode, isDirty, save } = editor;
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [showValidation, setShowValidation] = useState(false);
  const [needsFit, setNeedsFit] = useState(false);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
  const [isActivationOpen, setIsActivationOpen] = useState(false);
  const nodesInitialized = useNodesInitialized();

  // Closing or leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const saveVersion = useCallback(async () => {
    const issues = editor.issues.length;
    if (await save()) {
      toast[issues > 0 ? "warning" : "success"](
        `Saved as version ${editor.version + 1}`,
        {
          description:
            issues > 0
              ? `Saved with ${issues} validation issue${issues === 1 ? "" : "s"}.`
              : "Flow is valid.",
        }
      );
    }
  }, [editor.issues.length, editor.version, save]);

  // ⌘S saves a new version, as the empty settings panel says.
  useEffect(() => {
    if (!canManage) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (isDirty && !editor.isSaving) {
          saveVersion();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canManage, editor.isSaving, isDirty, saveVersion]);

  const firstIssueByNode = useMemo(() => {
    const first = new Map<string, string>();
    for (const issue of editor.issues) {
      if (issue.nodeId && !first.has(issue.nodeId)) {
        first.set(issue.nodeId, issueText(issue));
      }
    }
    return first;
  }, [editor.issues]);
  const nodeSummaries = useMemo(
    () =>
      new Map(
        editor.nodes.map((node) => [
          node.id,
          {
            name: node.data.name || node.data.nodeType,
            nodeType: node.data.nodeType,
          },
        ])
      ),
    [editor.nodes]
  );
  const edges = useMemo(
    () =>
      editor.edges.map((edge) =>
        edge.sourceHandle === "false"
          ? { ...edge, className: "edge-false" }
          : edge
      ),
    [editor.edges]
  );

  // Clicking a palette entry puts the first step in the middle of the canvas
  // and each later one to the right of the others, ready to be connected.
  const addFromPalette = useCallback(
    (nodeType: string) => {
      const rightmost = editor.nodes.reduce<
        { x: number; y: number } | undefined
      >(
        (furthest, node) =>
          furthest && furthest.x >= node.position.x ? furthest : node.position,
        undefined
      );
      if (rightmost) {
        addNode(nodeType, { x: rightmost.x + NODE_SPACING, y: rightmost.y });
      } else {
        const pane = document
          .querySelector(".flow-canvas .react-flow")
          ?.getBoundingClientRect();
        addNode(
          nodeType,
          screenToFlowPosition({
            x: (pane?.left ?? 0) + (pane?.width ?? 600) / 2,
            y: (pane?.top ?? 0) + (pane?.height ?? 400) / 2,
          })
        );
      }
      setNeedsFit(true);
    },
    [addNode, editor.nodes, screenToFlowPosition]
  );

  // Frames the whole flow once a step added from the palette has been
  // measured, so its handles are on screen and ready to connect.
  useEffect(() => {
    if (needsFit && nodesInitialized) {
      fitView(FIT_VIEW_OPTIONS);
      setNeedsFit(false);
    }
  }, [fitView, needsFit, nodesInitialized]);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const nodeType = event.dataTransfer.getData(PALETTE_DRAG_TYPE);
      if (!(canManage && nodeType)) {
        return;
      }
      event.preventDefault();
      addNode(
        nodeType,
        screenToFlowPosition({ x: event.clientX, y: event.clientY })
      );
    },
    [addNode, canManage, screenToFlowPosition]
  );

  if (editor.isLoading) {
    return <BuilderSkeleton />;
  }
  if (!editor.flow) {
    return (
      <div className="p-8">
        <ErrorAlert
          message={editor.error ?? "The flow could not be loaded."}
          onRetry={() => editor.reload()}
          title="Couldn't load the flow."
        />
      </div>
    );
  }

  const selected = editor.selectedNode;

  return (
    <NodeIssuesContext.Provider value={firstIssueByNode}>
      <div className="flex min-h-[640px] flex-1 flex-col">
        <BuilderHeader
          canManage={canManage}
          canRun={canRun}
          editor={editor}
          flow={editor.flow}
          onActivate={() => setIsActivationOpen(true)}
          onRun={() => setIsRunDialogOpen(true)}
          onSave={saveVersion}
          onToggleValidation={() => setShowValidation((current) => !current)}
          showValidation={showValidation}
        />

        {editor.error ? (
          <ErrorAlert
            className="m-3 mb-0"
            message={editor.error}
            title="Not saved."
          />
        ) : null}

        <div className="relative flex min-h-0 flex-1">
          {canManage ? (
            <NodePalette nodeTypes={editor.nodeTypes} onAdd={addFromPalette} />
          ) : null}
          <div className="flow-canvas relative min-w-0 flex-1">
            <ReactFlow
              deleteKeyCode={canManage ? DELETE_KEYS : null}
              edges={edges}
              edgesFocusable
              elementsSelectable
              fitView
              fitViewOptions={FIT_VIEW_OPTIONS}
              isValidConnection={editor.isValidConnection}
              minZoom={MIN_ZOOM}
              nodes={editor.nodes}
              nodesConnectable={canManage}
              nodesDraggable={canManage}
              nodesFocusable
              nodeTypes={CANVAS_NODE_TYPES}
              onConnect={editor.onConnect}
              onDragOver={(event) => {
                if (canManage) {
                  event.preventDefault();
                }
              }}
              onDrop={onDrop}
              onEdgesChange={editor.onEdgesChange}
              onNodesChange={editor.onNodesChange}
              onSelectionChange={({ nodes }) =>
                editor.setSelectedNodeId(nodes[0]?.id ?? null)
              }
            >
              <Background
                color="var(--input)"
                gap={18}
                size={1.2}
                variant={BackgroundVariant.Dots}
              />
              <Controls position="bottom-left" showInteractive={false} />
            </ReactFlow>
            {showValidation ? (
              <ValidationPopover
                issues={editor.issues}
                nodes={nodeSummaries}
                onClose={() => setShowValidation(false)}
                onSelectNode={editor.selectNode}
              />
            ) : null}
          </div>
          <div className="flex w-[330px] flex-none flex-col border-border border-l bg-card">
            {selected ? (
              <NodeConfigPanel
                canManage={canManage}
                flowId={flowId}
                issues={editor.issues.filter(
                  (issue) => issue.nodeId === selected.id
                )}
                key={selected.id}
                node={selected}
                nodeType={editor.nodeTypes.find(
                  (nodeType) => nodeType.type === selected.data.nodeType
                )}
                onChange={(patch) => editor.updateNode(selected.id, patch)}
                onClose={() => editor.selectNode(null)}
                onRemove={() => editor.removeNode(selected.id)}
              />
            ) : (
              <NothingSelected canManage={canManage} />
            )}
          </div>
        </div>
      </div>

      <ActivationPanel
        canManage={canManage}
        flowId={flowId}
        hasUnsavedChanges={isDirty}
        onOpenChange={setIsActivationOpen}
        open={isActivationOpen}
        organizationId={editor.flow.organizationId}
      />
      <RunDialog
        actionLabels={actionLabels(editor.definition)}
        flowId={flowId}
        flowName={editor.flow.name}
        inputs={triggerInputs(editor.definition)}
        onOpenChange={setIsRunDialogOpen}
        open={isRunDialogOpen}
        organizationId={editor.flow.organizationId}
        version={editor.version}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            editor.dismissConflict();
          }
        }}
        open={editor.hasConflict}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>This flow was changed by someone else</DialogTitle>
            <DialogDescription>
              A newer version was saved while you were editing. Your changes are
              still on the canvas. Reload to get the newer version and lose your
              changes, or keep editing and copy what you need first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={editor.dismissConflict}
              type="button"
              variant="outline"
            >
              Keep editing
            </Button>
            <Button
              onClick={() => {
                editor.reload();
              }}
              type="button"
            >
              Reload newer version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NodeIssuesContext.Provider>
  );
}

export function FlowBuilder(props: FlowBuilderProps) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}
