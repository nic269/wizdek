import { z } from "zod";
import type { NodeSpec } from "../definition/node-spec";
import type { AnyNodeDefinition } from "./define-node";

export interface NodeTypeMetadata {
  category: NodeSpec["category"];
  /** The config schema as JSON Schema, for rendering a form. */
  configSchema: unknown;
  description: string;
  idempotent: boolean;
  label: string;
  mode: NodeSpec["mode"];
  /** Fixed output handles, or null when they depend on the configuration. */
  outputs: readonly string[] | null;
  type: string;
}

export interface NodeRegistry {
  get(type: string): AnyNodeDefinition | undefined;
  list(): AnyNodeDefinition[];
  metadata(): NodeTypeMetadata[];
}

/**
 * The set of node types a process can run. New node types are added here;
 * the executor never needs to know about a specific one.
 */
export const createNodeRegistry = (
  nodes: readonly AnyNodeDefinition[]
): NodeRegistry => {
  const byType = new Map<string, AnyNodeDefinition>();
  for (const node of nodes) {
    if (byType.has(node.type)) {
      throw new Error(`Node type registered twice: ${node.type}`);
    }
    byType.set(node.type, node);
  }

  return {
    get: (type) => byType.get(type),
    list: () => [...byType.values()],
    metadata: () =>
      [...byType.values()].map((node) => ({
        category: node.category,
        configSchema: z.toJSONSchema(node.configSchema, { io: "input" }),
        description: node.description,
        idempotent: node.idempotent,
        label: node.label,
        mode: node.mode,
        outputs: typeof node.outputs === "function" ? null : node.outputs,
        type: node.type,
      })),
  };
};
