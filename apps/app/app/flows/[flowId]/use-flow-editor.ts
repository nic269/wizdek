"use client";

import {
  apiClient,
  getApiErrorCode,
  getApiErrorMessage,
} from "@repo/api/client";
import {
  type FlowDefinition,
  type FlowIssue,
  flowDefinitionSchema,
  resolveOutputs,
  validateFlowDefinition,
} from "@repo/flows/definition";
import {
  addEdge,
  type Connection,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { refuseConnection } from "./connection-rules";
import {
  CANVAS_NODE_TYPE,
  type CanvasEdge,
  type CanvasNode,
  canvasToDefinition,
  createEdgeId,
  createNodeId,
  definitionToCanvas,
} from "./flow-definition-mapping";
import { createStartingConfig, specsByType } from "./node-defaults";

export type Flow = Awaited<
  ReturnType<typeof apiClient.flows.get>
>["data"]["flow"];
export type NodeType = Awaited<
  ReturnType<typeof apiClient.flows.nodeTypes>
>["data"][number];

const EMPTY: FlowDefinition = { edges: [], nodes: [], schemaVersion: 1 };

const isTriggerType = (nodeType: string) =>
  specsByType.get(nodeType)?.category === "trigger";

/** Output handles of a node, falling back to none while its config is invalid. */
export const outputsOf = (
  nodeType: string,
  config: Record<string, unknown>
): readonly string[] => {
  const spec = specsByType.get(nodeType);
  if (!spec) {
    return [];
  }
  if (typeof spec.outputs !== "function") {
    return spec.outputs;
  }
  const parsed = spec.configSchema.safeParse(config);
  return parsed.success ? resolveOutputs(spec, parsed.data) : [];
};

/**
 * Holds the flow being edited. The canvas state is the flow definition in
 * another shape, so "unsaved" simply means the two no longer match.
 */
export const useFlowEditor = (flowId: string, canManage: boolean) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(JSON.stringify(EMPTY));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);

  const load = useCallback(async () => {
    const { data } = await apiClient.flows.get({ flowId });
    const parsed = flowDefinitionSchema.safeParse(data.version?.definition);
    const definition = parsed.success ? parsed.data : EMPTY;
    const canvas = definitionToCanvas(definition);
    setFlow(data.flow);
    setVersion(data.version?.version ?? 0);
    setNodes(canvas.nodes);
    setEdges(canvas.edges);
    setSaved(JSON.stringify(definition));
    setSelectedNodeId(null);
    setHasConflict(false);
    const types = await apiClient.flows.nodeTypes({
      organizationId: data.flow.organizationId,
    });
    setNodeTypes(types.data);
  }, [flowId, setEdges, setNodes]);

  useEffect(() => {
    load()
      .catch((cause: unknown) =>
        setError(getApiErrorMessage(cause, "Could not load the flow."))
      )
      .finally(() => setIsLoading(false));
  }, [load]);

  const definition = useMemo(
    () => canvasToDefinition(nodes, edges),
    [edges, nodes]
  );
  const isDirty = JSON.stringify(definition) !== saved;
  const issues = useMemo<FlowIssue[]>(
    () => validateFlowDefinition(definition, specsByType.values()).issues,
    [definition]
  );

  const isValidConnection = useCallback(
    (connection: Connection | CanvasEdge) =>
      refuseConnection(connection, edges, (nodeId) =>
        isTriggerType(
          nodes.find((node) => node.id === nodeId)?.data.nodeType ?? ""
        )
      ) === null,
    [edges, nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!(canManage && isValidConnection(connection))) {
        return;
      }
      const sourceHandle = connection.sourceHandle ?? "main";
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: createEdgeId(
              connection.source,
              sourceHandle,
              connection.target
            ),
            sourceHandle,
          },
          current
        )
      );
    },
    [canManage, isValidConnection, setEdges]
  );

  const addNode = useCallback(
    (nodeType: string, position: { x: number; y: number }) => {
      const label = specsByType.get(nodeType)?.label ?? nodeType;
      setNodes((current) => {
        const id = createNodeId(
          nodeType,
          new Set(current.map((node) => node.id))
        );
        setSelectedNodeId(id);
        return [
          ...current.map((node) => ({ ...node, selected: false })),
          {
            data: {
              config: createStartingConfig(nodeType),
              name: label,
              nodeType,
            },
            id,
            position,
            selected: true,
            type: CANVAS_NODE_TYPE,
          },
        ];
      });
    },
    [setNodes]
  );

  const updateNode = useCallback(
    (
      nodeId: string,
      patch: { config?: Record<string, unknown>; name?: string }
    ) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...patch } }
            : node
        )
      );
    },
    [setNodes]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setEdges((current) =>
        current.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId
        )
      );
      setSelectedNodeId(null);
    },
    [setEdges, setNodes]
  );

  const selectNode = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === nodeId }))
      );
    },
    [setNodes]
  );

  const save = useCallback(async () => {
    setError(null);
    setIsSaving(true);
    try {
      const { data } = await apiClient.flows.saveVersion({
        baseVersion: version,
        definition,
        flowId,
      });
      setFlow(data.flow);
      setVersion(data.version.version);
      setSaved(JSON.stringify(definition));
      return true;
    } catch (cause) {
      if (getApiErrorCode(cause) === "CONFLICT") {
        // Local edits stay on the canvas until the user chooses to reload.
        setHasConflict(true);
      } else {
        setError(getApiErrorMessage(cause, "Could not save the flow."));
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [definition, flowId, version]);

  return {
    addNode,
    definition,
    dismissConflict: () => setHasConflict(false),
    edges,
    error,
    flow,
    hasConflict,
    isDirty,
    isLoading,
    isSaving,
    issues,
    isValidConnection,
    nodes,
    nodeTypes,
    onConnect,
    onEdgesChange,
    onNodesChange,
    reload: load,
    removeNode,
    save,
    selectedNode: nodes.find((node) => node.id === selectedNodeId) ?? null,
    selectNode,
    setSelectedNodeId,
    updateNode,
    version,
  };
};

export type FlowEditor = ReturnType<typeof useFlowEditor>;
