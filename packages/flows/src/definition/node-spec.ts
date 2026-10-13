import type { z } from "zod";

export type NodeCategory = "trigger" | "data" | "logic" | "action";

/**
 * The part of a node type that is safe to share with the browser: what it is
 * called, how it is configured and which outputs it has. Behaviour is attached
 * on the server.
 */
export interface NodeSpec<TConfig = unknown> {
  category: NodeCategory;
  /** How many items the node may process at once. Defaults to 1. */
  concurrency?: number;
  configSchema: z.ZodType<TConfig>;
  description: string;
  /**
   * Whether repeating the node's effect for the same item is harmless. Items
   * of a node that is not idempotent are never run twice after a crash. May
   * depend on the configuration, for a node that can both read and write.
   */
  idempotent: boolean | ((config: TConfig) => boolean);
  label: string;
  /** `item` handles one item at a time; `batch` receives all of them at once. */
  mode: "item" | "batch";
  /** Output handles, fixed or derived from the node's configuration. */
  outputs: readonly string[] | ((config: TConfig) => readonly string[]);
  type: string;
}

/**
 * A spec of any config type. Specs are contravariant in their config, so a
 * list of different node types cannot be typed more precisely than this.
 */
// biome-ignore lint/suspicious/noExplicitAny: see the comment above
export type AnyNodeSpec = NodeSpec<any>;

export const defineNodeSpec = <TConfig>(
  spec: NodeSpec<TConfig>
): NodeSpec<TConfig> => spec;

export const resolveOutputs = <TConfig>(
  spec: NodeSpec<TConfig>,
  config: TConfig
): readonly string[] =>
  typeof spec.outputs === "function" ? spec.outputs(config) : spec.outputs;

export const resolveIdempotent = <TConfig>(
  spec: NodeSpec<TConfig>,
  config: TConfig
): boolean =>
  typeof spec.idempotent === "function"
    ? spec.idempotent(config)
    : spec.idempotent;

export const MAIN_OUTPUT = "main";
