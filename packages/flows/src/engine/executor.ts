import { prisma } from "@repo/database";
import {
  ShopifyGraphqlError,
  ShopifyTransportError,
  unwrapAdminGraphqlData,
} from "@repo/shopify/admin";
import {
  createStoreClient,
  type StoreClient,
  StoreNotFoundError,
  StoreReconnectRequiredError,
} from "@repo/shopify/stores";
import { resolveIdempotent, resolveOutputs } from "../definition/node-spec";
import {
  type FlowDefinition,
  type FlowNode,
  flowDefinitionSchema,
} from "../definition/schema";
import { resolveTemplate } from "../definition/template";
import { validateFlowDefinition } from "../definition/validate";
import {
  type AnyNodeDefinition,
  FlowFatalError,
  type FlowItem,
  type JsonObject,
  type NodeAsset,
  type NodeContext,
  type NodeLogger,
  type NodeOutput,
} from "../registry/define-node";
import type { NodeRegistry } from "../registry/registry";
import {
  assertItemSize,
  checkpointItem,
  countItemsByStatus,
  countNodeItems,
  ensureStep,
  ensureTriggerItem,
  type FlowRunItemRecord,
  type FlowRunStepRecord,
  listAllPendingItems,
  listPendingItems,
  markInterruptedItemsUnknown,
  markItemFailed,
  markItemInProgress,
  markItemPending,
  type RoutedItem,
  readStepState,
  toItemError,
  updateStep,
  writeStepState,
} from "./item-store";
import { buildTopology, type FlowTopology } from "./topology";

export interface ExecutorDependencies {
  createStoreClient?: typeof createStoreClient;
  logger?: NodeLogger;
  readAsset(organizationId: string, assetId: string): Promise<NodeAsset>;
  registry: NodeRegistry;
  /** Aborted when the process is asked to stop; the run then pauses. */
  signal?: AbortSignal;
}

/**
 * `finished` means the run reached a final status. `interrupted` means the
 * process is stopping and the run should be picked up again.
 */
export type ExecutionOutcome = "finished" | "interrupted";

type RunRecord = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

interface RunContext {
  deps: ExecutorDependencies;
  run: RunRecord;
  signal: AbortSignal;
  storeClient: StoreClient;
  topology: FlowTopology;
}

const TERMINAL_RUN_STATUSES = new Set([
  "SUCCEEDED",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELED",
]);
const TERMINAL_STEP_STATUSES = new Set(["SUCCEEDED", "FAILED", "SKIPPED"]);
const SILENT_LOGGER: NodeLogger = {
  info: () => undefined,
  warn: () => undefined,
};

const loadRun = (runId: string) =>
  prisma.flowRun.findUnique({
    include: { flowVersion: true },
    where: { id: runId },
  });

const asObject = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

/** Marker for "the process is stopping", as opposed to a failure. */
class RunInterrupted extends Error {}
class RunCanceled extends Error {}

const failRun = async (
  runId: string,
  error: { message: string; nodeId?: string }
) => {
  await prisma.flowRun.update({
    data: { completedAt: new Date(), error, status: "FAILED" },
    where: { id: runId },
  });
};

/**
 * Sends a node's outputs to the nodes connected to each output handle and
 * gives every new item its key. One output keeps the item's key; several add
 * an index. A node with several incoming edges also gets the source node in
 * the key, so items arriving by different paths never collide.
 */
const routeOutputs = (
  context: RunContext,
  node: FlowNode,
  item: FlowRunItemRecord,
  outputs: NodeOutput[]
): RoutedItem[] => {
  const handles = context.topology.downstream.get(node.id);
  const routed: RoutedItem[] = [];
  outputs.forEach((output, index) => {
    assertItemSize(output.json);
    const baseKey =
      outputs.length === 1 ? item.itemKey : `${item.itemKey}.${index}`;
    for (const target of handles?.get(output.handle) ?? []) {
      const merges = (context.topology.incoming.get(target) ?? 0) > 1;
      routed.push({
        itemKey: merges ? `${baseKey}@${node.id}` : baseKey,
        json: output.json,
        nodeId: target,
      });
    }
  });
  return routed;
};

const createNodeContext = (
  context: RunContext,
  idempotent: boolean,
  step: FlowRunStepRecord
): NodeContext => {
  const { run, storeClient } = context;
  const runInfo = {
    flowId: run.flowId,
    id: run.id,
    organizationId: run.organizationId,
    storeId: run.storeId,
    triggerType: run.triggerType,
  };
  const trigger = asObject(run.triggerPayload);
  return {
    logger: context.deps.logger ?? SILENT_LOGGER,
    resolve: (template, item: FlowItem) =>
      resolveTemplate(template, { json: item.json, run: runInfo, trigger }),
    run: runInfo,
    shopify: {
      request: async (query, variables) => {
        try {
          const result = await storeClient.requestWithRetry(
            { query, variables },
            {
              // A repeated request is only safe when the node says so.
              retryUncertain: idempotent,
              signal: context.signal,
            }
          );
          if (result.httpStatus === 401 || result.httpStatus === 403) {
            throw new FlowFatalError(
              "Shopify rejected the store's credentials. Reconnect the store, then run the flow again."
            );
          }
          return unwrapAdminGraphqlData(result);
        } catch (error) {
          if (
            error instanceof StoreReconnectRequiredError ||
            error instanceof StoreNotFoundError
          ) {
            throw new FlowFatalError(
              "The store needs to be reconnected before this flow can run."
            );
          }
          throw error;
        }
      },
    },
    signal: context.signal,
    stepState: {
      get: async (key) => (await readStepState(step.id))[key] as never,
      set: async (key, value) => {
        await writeStepState(step.id, {
          ...(await readStepState(step.id)),
          [key]: value,
        });
      },
    },
    storage: {
      readAsset: (assetId) =>
        context.deps.readAsset(run.organizationId, assetId),
    },
    store: {
      apiVersion: storeClient.store.apiVersion,
      currencyCode: storeClient.store.currencyCode,
      id: storeClient.store.id,
      name: storeClient.store.name,
      shopDomain: storeClient.store.shopDomain,
    },
  };
};

interface NodeRun {
  config: unknown;
  definition: AnyNodeDefinition;
  idempotent: boolean;
  node: FlowNode;
  nodeContext: NodeContext;
}

const assertKnownOutputs = (nodeRun: NodeRun, outputs: NodeOutput[]) => {
  const allowed = resolveOutputs(nodeRun.definition, nodeRun.config);
  const unknown = outputs.find(({ handle }) => !allowed.includes(handle));
  if (unknown) {
    throw new Error(
      `The node emitted to an unknown output "${unknown.handle}".`
    );
  }
};

/**
 * Runs one item through a node and records the outcome. Returns normally for
 * success and for an item failure; throws only when the run cannot go on.
 */
const processItem = async (
  context: RunContext,
  nodeRun: NodeRun,
  item: FlowRunItemRecord
): Promise<void> => {
  const { definition, idempotent, node } = nodeRun;
  const startedAt = Date.now();
  if (!definition.execute) {
    throw new FlowFatalError(
      `"${node.name || node.type}" cannot process single items.`
    );
  }
  if (!idempotent) {
    await markItemInProgress(item.id);
  }
  try {
    const { outputs } = await definition.execute({
      config: nodeRun.config,
      ctx: nodeRun.nodeContext,
      item: { json: asObject(item.input), key: item.itemKey },
    });
    assertKnownOutputs(nodeRun, outputs);
    await checkpointItem({
      attemptCounted: !idempotent,
      durationMs: Date.now() - startedAt,
      item,
      outputs,
      routed: routeOutputs(context, node, item, outputs),
    });
  } catch (error) {
    if (context.signal.aborted) {
      // Left as it is: pending items run again on resume, and an item that
      // was in progress is recorded as unknown.
      throw new RunInterrupted();
    }
    if (error instanceof FlowFatalError) {
      if (!idempotent) {
        await markItemPending(item.id);
      }
      throw error;
    }
    // A request that never got an answer may still have been applied.
    const uncertain =
      !idempotent &&
      (error instanceof ShopifyTransportError ||
        (error instanceof ShopifyGraphqlError && error.httpStatus >= 500));
    await markItemFailed(
      item.id,
      uncertain ? "UNKNOWN" : "FAILED",
      error,
      Date.now() - startedAt
    );
  }
};

/** Items go through the node a few at a time, each with its own checkpoint. */
const runItemMode = async (context: RunContext, nodeRun: NodeRun) => {
  const batchSize = Math.max(1, nodeRun.definition.concurrency ?? 1);
  for (;;) {
    await assertNotStopping(context);
    const batch = await listPendingItems(
      context.run.id,
      nodeRun.node.id,
      batchSize
    );
    if (batch.length === 0) {
      return;
    }
    const results = await Promise.allSettled(
      batch.map((item) => processItem(context, nodeRun, item))
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failure) {
      throw failure.reason;
    }
  }
};

/**
 * The node receives every pending item in one call and reports an outcome per
 * item. The node is responsible for resuming its own work; the executor only
 * records what it reports.
 */
const runBatchMode = async (context: RunContext, nodeRun: NodeRun) => {
  const { definition, node } = nodeRun;
  if (!definition.executeBatch) {
    throw new FlowFatalError(
      `"${node.name || node.type}" cannot process a batch.`
    );
  }
  await assertNotStopping(context);
  const items = await listAllPendingItems(context.run.id, node.id);
  if (items.length === 0) {
    return;
  }
  const startedAt = Date.now();
  let results: Awaited<
    ReturnType<NonNullable<AnyNodeDefinition["executeBatch"]>>
  >["results"];
  try {
    ({ results } = await definition.executeBatch({
      config: nodeRun.config,
      ctx: nodeRun.nodeContext,
      items: items.map((item) => ({
        json: asObject(item.input),
        key: item.itemKey,
      })),
    }));
  } catch (error) {
    if (context.signal.aborted) {
      throw new RunInterrupted();
    }
    throw error instanceof FlowFatalError
      ? error
      : new FlowFatalError(
          error instanceof Error ? error.message : "The batch failed."
        );
  }

  const byKey = new Map(results.map((result) => [result.key, result]));
  const durationMs = Date.now() - startedAt;
  for (const item of items) {
    const result = byKey.get(item.itemKey);
    if (result && "outputs" in result) {
      assertKnownOutputs(nodeRun, result.outputs);
      await checkpointItem({
        attemptCounted: false,
        durationMs,
        item,
        outputs: result.outputs,
        routed: routeOutputs(context, node, item, result.outputs),
      });
    } else {
      await markItemFailed(
        item.id,
        result?.uncertain ? "UNKNOWN" : "FAILED",
        new Error(
          result?.error ?? "The batch returned no result for this item."
        ),
        durationMs
      );
    }
  }
};

const assertNotStopping = async (context: RunContext) => {
  if (context.signal.aborted) {
    throw new RunInterrupted();
  }
  const current = await prisma.flowRun.findUniqueOrThrow({
    select: { cancelRequestedAt: true },
    where: { id: context.run.id },
  });
  if (current.cancelRequestedAt) {
    throw new RunCanceled();
  }
};

const runNode = async (context: RunContext, node: FlowNode): Promise<void> => {
  const definition = context.deps.registry.get(node.type);
  if (!definition) {
    throw new FlowFatalError(`Node type "${node.type}" is not available.`);
  }
  const step = await ensureStep(context.run.id, node.id, node.type);
  if (TERMINAL_STEP_STATUSES.has(step.status)) {
    return;
  }
  if (node.id === context.topology.trigger.id) {
    await ensureTriggerItem(
      context.run.id,
      node.id,
      asObject(context.run.triggerPayload)
    );
  }
  if ((await countNodeItems(context.run.id, node.id)) === 0) {
    await updateStep(step.id, { completedAt: new Date(), status: "SKIPPED" });
    return;
  }

  const parsed = definition.configSchema.safeParse(node.config);
  if (!parsed.success) {
    throw new FlowFatalError(
      `"${node.name || node.type}" is not configured correctly: ${parsed.error.issues[0]?.message ?? "invalid configuration"}.`
    );
  }
  await updateStep(step.id, {
    status: "RUNNING",
    ...(step.startedAt ? {} : { startedAt: new Date() }),
  });
  const idempotent = resolveIdempotent(definition, parsed.data);
  const nodeRun: NodeRun = {
    config: parsed.data,
    definition,
    idempotent,
    node,
    nodeContext: createNodeContext(context, idempotent, step),
  };
  await (definition.mode === "batch"
    ? runBatchMode(context, nodeRun)
    : runItemMode(context, nodeRun));
  await updateStep(step.id, { completedAt: new Date(), status: "SUCCEEDED" });
};

const finishRun = async (runId: string) => {
  const counts = await countItemsByStatus(runId);
  const troubled = (counts.FAILED ?? 0) + (counts.UNKNOWN ?? 0);
  await prisma.flowRun.update({
    data: {
      completedAt: new Date(),
      status: troubled > 0 ? "PARTIALLY_FAILED" : "SUCCEEDED",
    },
    where: { id: runId },
  });
};

const prepare = async (
  run: RunRecord,
  deps: ExecutorDependencies
): Promise<{ storeClient: StoreClient; topology: FlowTopology }> => {
  const parsed = flowDefinitionSchema.safeParse(run.flowVersion.definition);
  if (!parsed.success) {
    throw new FlowFatalError("The flow definition is not readable.");
  }
  const definition: FlowDefinition = parsed.data;
  const validation = validateFlowDefinition(definition, deps.registry.list());
  if (!validation.valid) {
    throw new FlowFatalError(
      `The flow is not valid: ${validation.issues[0]?.message ?? "unknown problem"}`
    );
  }
  try {
    const storeClient = await (deps.createStoreClient ?? createStoreClient)({
      organizationId: run.organizationId,
      storeId: run.storeId,
    });
    return {
      storeClient,
      topology: buildTopology(definition, (type) => deps.registry.get(type)),
    };
  } catch (error) {
    if (error instanceof StoreNotFoundError) {
      throw new FlowFatalError(
        "The store this run was started for no longer exists."
      );
    }
    throw error;
  }
};

/**
 * Executes a flow run, or continues one that was interrupted. Every item's
 * outcome is checkpointed as it happens, so calling this again after a crash
 * carries on from the first item without a checkpoint and never repeats one
 * that has one.
 */
export const executeFlowRun = async (
  runId: string,
  deps: ExecutorDependencies
): Promise<ExecutionOutcome> => {
  const run = await loadRun(runId);
  if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
    return "finished";
  }
  const signal = deps.signal ?? new AbortController().signal;
  if (run.cancelRequestedAt) {
    await prisma.flowRun.update({
      data: { completedAt: new Date(), status: "CANCELED" },
      where: { id: runId },
    });
    return "finished";
  }

  let failingNodeId: string | undefined;
  try {
    const { storeClient, topology } = await prepare(run, deps);
    await prisma.flowRun.update({
      data: {
        status: "RUNNING",
        ...(run.startedAt ? {} : { startedAt: new Date() }),
      },
      where: { id: runId },
    });
    await markInterruptedItemsUnknown(runId);

    const context: RunContext = { deps, run, signal, storeClient, topology };
    for (const node of topology.order) {
      failingNodeId = node.id;
      await runNode(context, node);
    }
    await finishRun(runId);
    return "finished";
  } catch (error) {
    if (error instanceof RunInterrupted) {
      return "interrupted";
    }
    if (error instanceof RunCanceled) {
      await prisma.flowRun.update({
        data: { completedAt: new Date(), status: "CANCELED" },
        where: { id: runId },
      });
      return "finished";
    }
    if (error instanceof FlowFatalError) {
      if (failingNodeId) {
        const step = await ensureStep(runId, failingNodeId, "");
        await updateStep(step.id, {
          completedAt: new Date(),
          error: { ...toItemError(error) },
          status: "FAILED",
        });
      }
      await failRun(runId, {
        message: error.message,
        ...(failingNodeId ? { nodeId: failingNodeId } : {}),
      });
      return "finished";
    }
    throw error;
  }
};
