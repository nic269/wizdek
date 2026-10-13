import { z } from "zod";

export const FLOW_SCHEMA_VERSION = 1;
export const MAX_FLOW_NODES = 100;
export const MAX_FLOW_EDGES = 500;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, hyphens and underscores.");

export const flowNodeSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  id: idSchema,
  name: z.string().max(120),
  position: z.object({ x: z.number(), y: z.number() }),
  type: z.string().min(1).max(64),
});

export const flowEdgeSchema = z.object({
  id: idSchema,
  source: idSchema,
  /** Which of the source node's outputs this edge leaves from. */
  sourceHandle: z.string().min(1).max(64),
  target: idSchema,
});

/**
 * A flow is plain data: nodes with their configuration and the edges between
 * them. Nothing in a definition is executable.
 */
export const flowDefinitionSchema = z.object({
  edges: z.array(flowEdgeSchema).max(MAX_FLOW_EDGES),
  nodes: z.array(flowNodeSchema).max(MAX_FLOW_NODES),
  schemaVersion: z.literal(FLOW_SCHEMA_VERSION),
});

export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export const emptyFlowDefinition = (): FlowDefinition => ({
  edges: [],
  nodes: [],
  schemaVersion: FLOW_SCHEMA_VERSION,
});
