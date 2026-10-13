import type { NodeSpec } from "../definition/node-spec";

export type JsonObject = Record<string, unknown>;

/** One unit of data moving through a flow. */
export interface FlowItem {
  json: JsonObject;
  /** Stable within the run; used to resume without repeating work. */
  key: string;
}

export interface NodeOutput {
  handle: string;
  json: JsonObject;
}

export interface NodeLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface NodeRunInfo {
  flowId: string;
  id: string;
  organizationId: string;
  storeId: string;
  triggerType: string;
}

export interface NodeStoreInfo {
  apiVersion: string;
  currencyCode: string | null;
  id: string;
  name: string;
  shopDomain: string;
}

export interface NodeAsset {
  body: Uint8Array;
  contentType: string;
  fileName: string;
}

/** What a node may use while it runs. Everything is scoped to the run. */
export interface NodeContext {
  logger: NodeLogger;
  /** Fills `{{ ... }}` placeholders from the item, the trigger and the run. */
  resolve(template: string, item: FlowItem): unknown;
  run: NodeRunInfo;
  shopify: {
    /**
     * Sends Admin GraphQL to the run's store and returns `data`. The token is
     * resolved here and throttling is waited out; GraphQL errors throw.
     */
    request<TData = unknown>(
      query: string,
      variables?: Record<string, unknown>
    ): Promise<TData>;
  };
  signal: AbortSignal;
  /** Small persisted state for the node within this run. */
  stepState: {
    get<TValue = unknown>(key: string): Promise<TValue | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  storage: {
    /** Reads a file uploaded to the run's organization. */
    readAsset(assetId: string): Promise<NodeAsset>;
  };
  store: NodeStoreInfo;
}

export interface NodeExecuteInput<TConfig> {
  config: TConfig;
  ctx: NodeContext;
  item: FlowItem;
}

export interface NodeExecuteResult {
  outputs: NodeOutput[];
}

export interface NodeBatchInput<TConfig> {
  config: TConfig;
  ctx: NodeContext;
  /** Every item waiting at the node, in arrival order. */
  items: FlowItem[];
}

/** The outcome of one item of a batch, matched to its item by key. */
export type NodeBatchItemResult =
  | { key: string; outputs: NodeOutput[] }
  | {
      error: string;
      key: string;
      /** True when the item's effect may have been applied anyway. */
      uncertain?: boolean;
    };

export interface NodeDefinition<TConfig = unknown> extends NodeSpec<TConfig> {
  /** Handles one item. Required for `mode: "item"`. */
  execute?(input: NodeExecuteInput<TConfig>): Promise<NodeExecuteResult>;
  /**
   * Handles all of the node's items in one call. Required for
   * `mode: "batch"`. The node keeps what it needs to resume in `stepState`.
   */
  executeBatch?(
    input: NodeBatchInput<TConfig>
  ): Promise<{ results: NodeBatchItemResult[] }>;
}

// biome-ignore lint/suspicious/noExplicitAny: node types differ in their config
export type AnyNodeDefinition = NodeDefinition<any>;

/** Attaches per-item behaviour to a node spec. */
export const defineNode = <TConfig>(
  spec: NodeSpec<TConfig>,
  execute: NonNullable<NodeDefinition<TConfig>["execute"]>
): NodeDefinition<TConfig> & {
  execute: NonNullable<NodeDefinition<TConfig>["execute"]>;
} => ({ ...spec, execute });

/** Attaches whole-batch behaviour to a node spec whose mode is `batch`. */
export const defineBatchNode = <TConfig>(
  spec: NodeSpec<TConfig>,
  executeBatch: NonNullable<NodeDefinition<TConfig>["executeBatch"]>
): NodeDefinition<TConfig> => ({ ...spec, executeBatch });

/**
 * Thrown for a problem with the item being processed. The item is recorded as
 * failed with this message and the run carries on with the others.
 */
export class FlowItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowItemError";
  }
}

/**
 * Thrown when the node cannot work at all, for example because the store
 * needs reconnecting. The run fails and its remaining items stay pending.
 * It must only be thrown when the item's effect has not been applied.
 */
export class FlowFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowFatalError";
  }
}
