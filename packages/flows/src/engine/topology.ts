import type { NodeSpec } from "../definition/node-spec";
import type { FlowDefinition, FlowNode } from "../definition/schema";

export interface FlowTopology {
  /** For each node, the target node ids of each output handle. */
  downstream: Map<string, Map<string, string[]>>;
  /** How many edges arrive at each node. */
  incoming: Map<string, number>;
  /** Nodes reachable from the trigger, every node after all of its sources. */
  order: FlowNode[];
  trigger: FlowNode;
}

const indexEdges = (definition: FlowDefinition) => {
  const downstream = new Map<string, Map<string, string[]>>();
  const incoming = new Map<string, number>();
  for (const edge of definition.edges) {
    const handles = downstream.get(edge.source) ?? new Map<string, string[]>();
    handles.set(edge.sourceHandle, [
      ...(handles.get(edge.sourceHandle) ?? []),
      edge.target,
    ]);
    downstream.set(edge.source, handles);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  return { downstream, incoming };
};

const findReachable = (
  start: string,
  targetsOf: (nodeId: string) => string[]
): Set<string> => {
  const reachable = new Set([start]);
  const frontier = [start];
  for (let current = frontier.pop(); current; current = frontier.pop()) {
    for (const target of targetsOf(current)) {
      if (!reachable.has(target)) {
        reachable.add(target);
        frontier.push(target);
      }
    }
  }
  return reachable;
};

/** Kahn's algorithm over the reachable part of the graph. */
const sortReachable = (
  start: string,
  reachable: Set<string>,
  targetsOf: (nodeId: string) => string[]
): string[] => {
  const waitingOn = new Map<string, number>();
  for (const source of reachable) {
    for (const target of targetsOf(source)) {
      waitingOn.set(target, (waitingOn.get(target) ?? 0) + 1);
    }
  }
  const ready = [start];
  const order: string[] = [];
  for (let current = ready.shift(); current; current = ready.shift()) {
    order.push(current);
    for (const target of targetsOf(current)) {
      const left = (waitingOn.get(target) ?? 0) - 1;
      waitingOn.set(target, left);
      if (left === 0) {
        ready.push(target);
      }
    }
  }
  return order;
};

/**
 * Orders a validated definition for execution. Assumes exactly one trigger
 * and no cycles; nodes the trigger cannot reach are left out.
 */
export const buildTopology = (
  definition: FlowDefinition,
  specs: (type: string) => Pick<NodeSpec, "category"> | undefined
): FlowTopology => {
  const trigger = definition.nodes.find(
    (node) => specs(node.type)?.category === "trigger"
  );
  if (!trigger) {
    throw new Error("The flow has no trigger.");
  }
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const { downstream, incoming } = indexEdges(definition);
  // Distinct targets: two edges between the same pair count once for ordering.
  const targetsOf = (nodeId: string) => [
    ...new Set([...(downstream.get(nodeId)?.values() ?? [])].flat()),
  ];

  const reachable = findReachable(trigger.id, targetsOf);
  const order = sortReachable(trigger.id, reachable, targetsOf)
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is FlowNode => node !== undefined);
  if (order.length !== reachable.size) {
    throw new Error("The flow contains a loop.");
  }
  return { downstream, incoming, order, trigger };
};
