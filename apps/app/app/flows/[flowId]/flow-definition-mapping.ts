import {
  FLOW_SCHEMA_VERSION,
  type FlowDefinition,
} from "@repo/flows/definition";
import type { Edge, Node } from "@xyflow/react";

/** The single custom node renderer; the flow node type lives in `data`. */
export const CANVAS_NODE_TYPE = "flowNode";

export interface FlowNodeData extends Record<string, unknown> {
  config: Record<string, unknown>;
  name: string;
  /** The flow node type, such as `shopify.addTags`. */
  nodeType: string;
}

export type CanvasNode = Node<FlowNodeData, typeof CANVAS_NODE_TYPE>;
export type CanvasEdge = Edge;

/**
 * The canvas shows the same definition the engine runs. These two functions
 * are the whole translation, and applying one after the other changes nothing.
 */
export const definitionToCanvas = (
  definition: FlowDefinition
): { edges: CanvasEdge[]; nodes: CanvasNode[] } => ({
  edges: definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
  })),
  nodes: definition.nodes.map((node) => ({
    data: { config: node.config, name: node.name, nodeType: node.type },
    id: node.id,
    position: { x: node.position.x, y: node.position.y },
    type: CANVAS_NODE_TYPE,
  })),
});

export const canvasToDefinition = (
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): FlowDefinition => ({
  edges: edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? "main",
    target: edge.target,
  })),
  nodes: nodes.map((node) => ({
    config: node.data.config,
    id: node.id,
    name: node.data.name,
    position: { x: node.position.x, y: node.position.y },
    type: node.data.nodeType,
  })),
  schemaVersion: FLOW_SCHEMA_VERSION,
});

/** An id unused by the given nodes, readable in a saved definition. */
export const createNodeId = (
  nodeType: string,
  existingIds: ReadonlySet<string>
): string => {
  const base = (nodeType.split(".").at(-1) ?? "node").replace(
    /[^A-Za-z0-9_-]/g,
    ""
  );
  let index = 1;
  while (existingIds.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
};

export const createEdgeId = (
  source: string,
  sourceHandle: string,
  target: string
) => `${source}-${sourceHandle}-${target}`;
