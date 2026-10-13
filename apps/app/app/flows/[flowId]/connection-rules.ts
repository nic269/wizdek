export interface ProposedConnection {
  source: string | null;
  sourceHandle?: string | null;
  target: string | null;
}

interface ExistingEdge {
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export type ConnectionRefusal =
  | "INCOMPLETE"
  | "SELF_LOOP"
  | "INTO_TRIGGER"
  | "DUPLICATE"
  | "CYCLE";

const reaches = (
  from: string,
  to: string,
  edges: readonly ExistingEdge[]
): boolean => {
  const seen = new Set([from]);
  const frontier = [from];
  for (let current = frontier.pop(); current; current = frontier.pop()) {
    if (current === to) {
      return true;
    }
    for (const edge of edges) {
      if (edge.source === current && !seen.has(edge.target)) {
        seen.add(edge.target);
        frontier.push(edge.target);
      }
    }
  }
  return false;
};

/**
 * Says why a connection being dragged must be refused, or null when it is
 * fine. Flows run in one direction, so a connection may not loop back, and a
 * trigger only ever starts a flow.
 */
export const refuseConnection = (
  connection: ProposedConnection,
  edges: readonly ExistingEdge[],
  isTrigger: (nodeId: string) => boolean
): ConnectionRefusal | null => {
  const { source, target } = connection;
  if (!(source && target)) {
    return "INCOMPLETE";
  }
  if (source === target) {
    return "SELF_LOOP";
  }
  if (isTrigger(target)) {
    return "INTO_TRIGGER";
  }
  const handle = connection.sourceHandle ?? "main";
  if (
    edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        (edge.sourceHandle ?? "main") === handle
    )
  ) {
    return "DUPLICATE";
  }
  // Adding source -> target closes a loop when target already leads to source.
  return reaches(target, source, edges) ? "CYCLE" : null;
};
