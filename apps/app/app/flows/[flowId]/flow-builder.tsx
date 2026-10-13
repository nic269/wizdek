"use client";

import "@xyflow/react/dist/style.css";
import "./flow-builder.css";
import {
  Button,
  buttonVariants,
  ErrorState,
  LoadingState,
} from "@repo/design-system";
import { Badge } from "@repo/design-system/components/ui/badge";
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
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAppTheme } from "../../lib/use-app-theme";
import { FLOW_STATUS_LABELS } from "../flow-labels";
import type { FlowBuilderProps } from "./flow-builder-loader";
import { CANVAS_NODE_TYPE } from "./flow-definition-mapping";
import { FlowNodeCard, NodeIssuesContext } from "./flow-node";
import { NodeConfigPanel } from "./node-config-panel";
import { NodePalette, PALETTE_DRAG_TYPE } from "./node-palette";
import { RunDialog, type RunInput } from "./run-dialog";
import { type Flow, type FlowEditor, useFlowEditor } from "./use-flow-editor";
import { ValidationPanel } from "./validation-panel";

const CANVAS_NODE_TYPES = { [CANVAS_NODE_TYPE]: FlowNodeCard };
const DELETE_KEYS = ["Backspace", "Delete"];
/** Horizontal distance between steps added by clicking the palette. */
const NODE_SPACING = 260;
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

function BuilderToolbar({
  canManage,
  canRun,
  editor,
  flow,
  onRun,
  onValidate,
}: {
  canManage: boolean;
  canRun: boolean;
  editor: FlowEditor;
  flow: Flow;
  onRun: () => void;
  onValidate: () => void;
}) {
  const { isDirty } = editor;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <a
          className="text-muted-foreground text-sm hover:underline"
          href="/flows"
        >
          Flows
        </a>
        <h1 className="truncate font-semibold text-xl">{flow.name}</h1>
        <Badge variant="outline">{FLOW_STATUS_LABELS[flow.status]}</Badge>
        <span className="text-muted-foreground text-xs">
          Version {editor.version}
        </span>
        {canManage ? null : <Badge variant="secondary">Read-only</Badge>}
        {isDirty ? (
          <span className="text-amber-600 text-xs dark:text-amber-400">
            Unsaved changes
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onValidate} type="button" variant="outline">
          Validate
        </Button>
        <a
          className={buttonVariants({ variant: "outline" })}
          href={`/flows/${flow.id}/runs`}
        >
          Runs
        </a>
        {canManage ? (
          <Button
            disabled={editor.isSaving || !isDirty}
            onClick={() => {
              onValidate();
              editor.save();
            }}
            type="button"
          >
            {editor.isSaving ? "Saving..." : "Save"}
          </Button>
        ) : null}
        {canRun ? (
          <Button
            disabled={isDirty || editor.issues.length > 0}
            onClick={onRun}
            title={runBlockedReason(isDirty, editor.issues.length)}
            type="button"
            variant={canManage ? "outline" : "default"}
          >
            Run
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Builder({ canManage, canRun, flowId }: FlowBuilderProps) {
  const editor = useFlowEditor(flowId, canManage);
  const { addNode, isDirty } = editor;
  const { fitView, screenToFlowPosition } = useReactFlow();
  const theme = useAppTheme();
  const [showValidation, setShowValidation] = useState(false);
  const [needsFit, setNeedsFit] = useState(false);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
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

  const issuesByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of editor.issues) {
      if (issue.nodeId) {
        counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [editor.issues]);
  const nodeNames = useMemo(
    () =>
      new Map(
        editor.nodes.map((node) => [
          node.id,
          node.data.name || node.data.nodeType,
        ])
      ),
    [editor.nodes]
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
          .querySelector(".react-flow")
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
    return <LoadingState label="Loading flow" />;
  }
  if (!editor.flow) {
    return (
      <ErrorState message={editor.error ?? "The flow could not be loaded."} />
    );
  }

  const selected = editor.selectedNode;

  return (
    <NodeIssuesContext.Provider value={issuesByNode}>
      <div className="space-y-3">
        <BuilderToolbar
          canManage={canManage}
          canRun={canRun}
          editor={editor}
          flow={editor.flow}
          onRun={() => setIsRunDialogOpen(true)}
          onValidate={() => setShowValidation(true)}
        />

        {editor.error ? <ErrorState message={editor.error} /> : null}
        {showValidation ? (
          <ValidationPanel
            issues={editor.issues}
            nodeNames={nodeNames}
            onSelectNode={editor.selectNode}
          />
        ) : null}

        <div
          className={`flow-builder grid overflow-hidden rounded-md border ${
            canManage ? "grid-cols-[12rem_1fr_19rem]" : "grid-cols-[1fr_19rem]"
          }`}
        >
          {canManage ? (
            <div className="border-r">
              <NodePalette
                nodeTypes={editor.nodeTypes}
                onAdd={addFromPalette}
              />
            </div>
          ) : null}
          <div className="h-full">
            <ReactFlow
              colorMode={theme}
              deleteKeyCode={canManage ? DELETE_KEYS : null}
              edges={editor.edges}
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
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="border-l">
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
                onRemove={() => editor.removeNode(selected.id)}
              />
            ) : (
              <p className="p-4 text-muted-foreground text-sm">
                {canManage
                  ? "Add a step from the palette, then select it to configure it. Connect steps by dragging from one handle to another, or by clicking one handle and then the other."
                  : "Select a step to see how it is configured."}
              </p>
            )}
          </div>
        </div>
      </div>

      <RunDialog
        flowId={flowId}
        inputs={triggerInputs(editor.definition)}
        onOpenChange={setIsRunDialogOpen}
        open={isRunDialogOpen}
        organizationId={editor.flow.organizationId}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            editor.dismissConflict();
          }
        }}
        open={editor.hasConflict}
      >
        <DialogContent>
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
