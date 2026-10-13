import { type AnyNodeSpec, resolveOutputs } from "./node-spec";
import { type FlowDefinition, type FlowNode, MAX_FLOW_NODES } from "./schema";

export type FlowIssueCode =
  | "NO_TRIGGER"
  | "MULTIPLE_TRIGGERS"
  | "TOO_MANY_NODES"
  | "DUPLICATE_NODE"
  | "UNKNOWN_NODE_TYPE"
  | "INVALID_CONFIG"
  | "EDGE_ENDPOINT_MISSING"
  | "UNKNOWN_OUTPUT"
  | "EDGE_INTO_TRIGGER"
  | "CYCLE"
  | "UNREACHABLE";

export interface FlowIssue {
  code: FlowIssueCode;
  edgeId?: string;
  message: string;
  /** The node the issue belongs to; absent for flow-level issues. */
  nodeId?: string;
  /** Path of the offending config field, for INVALID_CONFIG. */
  path?: string;
}

export interface FlowValidationResult {
  issues: FlowIssue[];
  valid: boolean;
}

const indexSpecs = (specs: Iterable<AnyNodeSpec>) => {
  const byType = new Map<string, AnyNodeSpec>();
  for (const spec of specs) {
    byType.set(spec.type, spec);
  }
  return byType;
};

/** Checks each node on its own: known type, unique id, valid config. */
const checkNodes = (
  nodes: FlowNode[],
  specs: Map<string, AnyNodeSpec>,
  issues: FlowIssue[]
) => {
  const seen = new Set<string>();
  /** Output handles of every node whose config could be parsed. */
  const outputs = new Map<string, readonly string[]>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      issues.push({
        code: "DUPLICATE_NODE",
        message: `Node id "${node.id}" is used more than once.`,
        nodeId: node.id,
      });
      continue;
    }
    seen.add(node.id);
    const spec = specs.get(node.type);
    if (!spec) {
      issues.push({
        code: "UNKNOWN_NODE_TYPE",
        message: `Node type "${node.type}" is not available.`,
        nodeId: node.id,
      });
      continue;
    }
    const parsed = spec.configSchema.safeParse(node.config);
    if (parsed.success) {
      outputs.set(node.id, resolveOutputs(spec, parsed.data));
      continue;
    }
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      issues.push({
        code: "INVALID_CONFIG",
        message: path ? `${path}: ${issue.message}` : issue.message,
        nodeId: node.id,
        ...(path ? { path } : {}),
      });
    }
  }
  return outputs;
};

const checkTriggers = (
  nodes: FlowNode[],
  specs: Map<string, AnyNodeSpec>,
  issues: FlowIssue[]
): FlowNode | undefined => {
  const [first, ...extra] = nodes.filter(
    (node) => specs.get(node.type)?.category === "trigger"
  );
  if (!first) {
    issues.push({
      code: "NO_TRIGGER",
      message: "A flow needs a trigger to start from.",
    });
    return;
  }
  for (const node of extra) {
    issues.push({
      code: "MULTIPLE_TRIGGERS",
      message: "A flow can have only one trigger.",
      nodeId: node.id,
    });
  }
  return first;
};

/** Checks edges and returns the usable ones as an adjacency list. */
const checkEdges = (
  definition: FlowDefinition,
  specs: Map<string, AnyNodeSpec>,
  outputs: Map<string, readonly string[]>,
  issues: FlowIssue[]
) => {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!(source && target)) {
      issues.push({
        code: "EDGE_ENDPOINT_MISSING",
        edgeId: edge.id,
        message: "A connection points at a node that no longer exists.",
        ...(source ? { nodeId: source.id } : {}),
      });
      continue;
    }
    if (specs.get(target.type)?.category === "trigger") {
      issues.push({
        code: "EDGE_INTO_TRIGGER",
        edgeId: edge.id,
        message: "A trigger cannot receive items from another node.",
        nodeId: target.id,
      });
      continue;
    }
    const handles = outputs.get(source.id);
    if (handles && !handles.includes(edge.sourceHandle)) {
      issues.push({
        code: "UNKNOWN_OUTPUT",
        edgeId: edge.id,
        message: `"${source.name || source.type}" has no output named "${edge.sourceHandle}".`,
        nodeId: source.id,
      });
      continue;
    }
    adjacency.set(source.id, [...(adjacency.get(source.id) ?? []), target.id]);
  }
  return adjacency;
};

/** Finds the nodes that sit on a cycle, using three-colour depth-first search. */
const findCycleNodes = (
  nodes: FlowNode[],
  adjacency: Map<string, string[]>
): Set<string> => {
  const state = new Map<string, "visiting" | "done">();
  const onCycle = new Set<string>();
  const visit = (nodeId: string, path: string[]) => {
    state.set(nodeId, "visiting");
    path.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (state.get(next) === "visiting") {
        for (const member of path.slice(path.indexOf(next))) {
          onCycle.add(member);
        }
      } else if (!state.has(next)) {
        visit(next, path);
      }
    }
    path.pop();
    state.set(nodeId, "done");
  };
  for (const node of nodes) {
    if (!state.has(node.id)) {
      visit(node.id, []);
    }
  }
  return onCycle;
};

const findReachable = (
  start: string,
  adjacency: Map<string, string[]>
): Set<string> => {
  const reachable = new Set([start]);
  const queue = [start];
  for (let current = queue.shift(); current; current = queue.shift()) {
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
};

/**
 * Checks that a definition can run. Pure: it takes the available node types
 * as an argument, so the canvas and the server apply the same rules.
 */
export const validateFlowDefinition = (
  definition: FlowDefinition,
  nodeSpecs: Iterable<AnyNodeSpec>
): FlowValidationResult => {
  const specs = indexSpecs(nodeSpecs);
  const issues: FlowIssue[] = [];

  if (definition.nodes.length > MAX_FLOW_NODES) {
    issues.push({
      code: "TOO_MANY_NODES",
      message: `A flow can have at most ${MAX_FLOW_NODES} nodes.`,
    });
  }
  const outputs = checkNodes(definition.nodes, specs, issues);
  const trigger = checkTriggers(definition.nodes, specs, issues);
  const adjacency = checkEdges(definition, specs, outputs, issues);

  for (const nodeId of findCycleNodes(definition.nodes, adjacency)) {
    issues.push({
      code: "CYCLE",
      message: "This node is part of a loop. Flows must run in one direction.",
      nodeId,
    });
  }
  if (trigger) {
    const reachable = findReachable(trigger.id, adjacency);
    for (const node of definition.nodes) {
      const isExtraTrigger =
        node.id !== trigger.id && specs.get(node.type)?.category === "trigger";
      if (!(reachable.has(node.id) || isExtraTrigger)) {
        issues.push({
          code: "UNREACHABLE",
          message:
            "This node is not connected to the trigger and would never run.",
          nodeId: node.id,
        });
      }
    }
  }

  return { issues, valid: issues.length === 0 };
};
