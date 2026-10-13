import { type Prisma, prisma } from "@repo/database";
import type { JsonObject, NodeOutput } from "../registry/define-node";
import { FlowFatalError, FlowItemError } from "../registry/define-node";
import { INSERT_CHUNK_SIZE, MAX_ITEM_BYTES, MAX_ITEMS_PER_RUN } from "./limits";

export type FlowRunItemRecord = Prisma.FlowRunItemGetPayload<object>;
export type FlowRunStepRecord = Prisma.FlowRunStepGetPayload<object>;

export interface ItemError {
  message: string;
  name: string;
}

/** Items a node emitted, already addressed to the nodes that receive them. */
export interface RoutedItem {
  itemKey: string;
  json: JsonObject;
  nodeId: string;
}

const OUTPUT_SAMPLE_SIZE = 5;

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

export const toItemError = (error: unknown): ItemError =>
  error instanceof Error
    ? { message: error.message, name: error.name }
    : { message: "Unknown error", name: "Error" };

/**
 * What is kept on the item as its result. A node that fans one item out into
 * many keeps a count and a sample, since each emitted item is stored anyway
 * as the input of the next node.
 */
const snapshotOutputs = (outputs: NodeOutput[]) => {
  const [only, ...others] = outputs;
  if (only && others.length === 0) {
    return { handle: only.handle, output: only.json };
  }
  const handles: Record<string, number> = {};
  for (const { handle } of outputs) {
    handles[handle] = (handles[handle] ?? 0) + 1;
  }
  return {
    handle: null,
    output: {
      count: outputs.length,
      // How many items left by each output, for the counts shown on edges.
      handles,
      sample: outputs.slice(0, OUTPUT_SAMPLE_SIZE),
    },
  };
};

export const assertItemSize = (json: JsonObject): void => {
  if (JSON.stringify(json).length > MAX_ITEM_BYTES) {
    throw new FlowItemError("The item is larger than the 1 MB limit.");
  }
};

/** Creates the trigger's single item from the values the run started with. */
export const ensureTriggerItem = async (
  runId: string,
  nodeId: string,
  json: JsonObject
): Promise<void> => {
  await prisma.flowRunItem.createMany({
    data: [{ input: asJson(json), itemKey: "0", nodeId, runId }],
    skipDuplicates: true,
  });
};

export const countNodeItems = (runId: string, nodeId: string) =>
  prisma.flowRunItem.count({ where: { nodeId, runId } });

export const listPendingItems = (
  runId: string,
  nodeId: string,
  limit: number
): Promise<FlowRunItemRecord[]> =>
  prisma.flowRunItem.findMany({
    orderBy: { ordinal: "asc" },
    take: limit,
    where: { nodeId, runId, status: "PENDING" },
  });

/**
 * Marks an item as started before a call that must not be repeated. If the
 * process dies during the call, the item is found in this state on resume.
 */
export const markItemInProgress = async (itemId: string): Promise<void> => {
  await prisma.flowRunItem.update({
    data: { attempts: { increment: 1 }, status: "IN_PROGRESS" },
    where: { id: itemId },
  });
};

export const markItemPending = async (itemId: string): Promise<void> => {
  await prisma.flowRunItem.update({
    data: { status: "PENDING" },
    where: { id: itemId },
  });
};

export const markItemFailed = async (
  itemId: string,
  status: "FAILED" | "UNKNOWN",
  error: unknown,
  durationMs: number
): Promise<void> => {
  await prisma.flowRunItem.update({
    data: { durationMs, error: asJson(toItemError(error)), status },
    where: { id: itemId },
  });
};

/**
 * The checkpoint: marks the item done and hands its outputs to the next
 * nodes in one transaction, so a crash leaves either both or neither. This is
 * the only place an item and its downstream rows change together.
 */
export const checkpointItem = async (input: {
  durationMs: number;
  item: FlowRunItemRecord;
  /** Whether the node marked the item in progress, which counts the attempt. */
  attemptCounted: boolean;
  outputs: NodeOutput[];
  routed: RoutedItem[];
}): Promise<void> => {
  const { handle, output } = snapshotOutputs(input.outputs);
  await prisma.$transaction(
    async (transaction) => {
      await transaction.flowRunItem.update({
        data: {
          durationMs: input.durationMs,
          output: asJson(output),
          outputHandle: handle,
          status: "SUCCEEDED",
          ...(input.attemptCounted ? {} : { attempts: { increment: 1 } }),
        },
        where: { id: input.item.id },
      });

      let inserted = 0;
      for (
        let start = 0;
        start < input.routed.length;
        start += INSERT_CHUNK_SIZE
      ) {
        const { count } = await transaction.flowRunItem.createMany({
          data: input.routed
            .slice(start, start + INSERT_CHUNK_SIZE)
            .map(({ itemKey, json, nodeId }) => ({
              input: asJson(json),
              itemKey,
              nodeId,
              runId: input.item.runId,
            })),
          skipDuplicates: true,
        });
        inserted += count;
      }
      if (inserted === 0) {
        return;
      }
      const run = await transaction.flowRun.update({
        data: { itemCount: { increment: inserted } },
        select: { itemCount: true },
        where: { id: input.item.runId },
      });
      if (run.itemCount > MAX_ITEMS_PER_RUN) {
        throw new FlowFatalError(
          `The run produced more than ${MAX_ITEMS_PER_RUN} items.`
        );
      }
    },
    { timeout: 60_000 }
  );
};

/**
 * After an interruption, items of nodes that must not repeat their effect
 * may or may not have been applied. They are recorded as unknown.
 */
export const markInterruptedItemsUnknown = async (
  runId: string
): Promise<number> => {
  const { count } = await prisma.flowRunItem.updateMany({
    data: {
      error: asJson({
        message:
          "The run was interrupted while this item was being processed, so its outcome is unknown. Check the store before repeating it.",
        name: "InterruptedError",
      }),
      status: "UNKNOWN",
    },
    where: { runId, status: "IN_PROGRESS" },
  });
  return count;
};

export const countItemsByStatus = async (runId: string) => {
  const groups = await prisma.flowRunItem.groupBy({
    _count: { _all: true },
    by: ["status"],
    where: { runId },
  });
  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
};

export const ensureStep = (
  runId: string,
  nodeId: string,
  nodeType: string
): Promise<FlowRunStepRecord> =>
  prisma.flowRunStep.upsert({
    create: { nodeId, nodeType, runId },
    update: {},
    where: { runId_nodeId: { nodeId, runId } },
  });

export const updateStep = async (
  stepId: string,
  data: Prisma.FlowRunStepUpdateInput
): Promise<void> => {
  await prisma.flowRunStep.update({ data, where: { id: stepId } });
};

export const readStepState = async (
  stepId: string
): Promise<Record<string, unknown>> => {
  const step = await prisma.flowRunStep.findUniqueOrThrow({
    select: { state: true },
    where: { id: stepId },
  });
  return step.state &&
    typeof step.state === "object" &&
    !Array.isArray(step.state)
    ? (step.state as Record<string, unknown>)
    : {};
};

export const writeStepState = async (
  stepId: string,
  state: Record<string, unknown>
): Promise<void> => {
  await prisma.flowRunStep.update({
    data: { state: asJson(state) },
    where: { id: stepId },
  });
};
