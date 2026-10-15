import { type Prisma, prisma } from "@repo/database";
import type { JobQueueProvider } from "@repo/jobs";
import type { z } from "zod";
import type { manualInputSchema } from "../definition/specs/trigger-manual";
import { enqueueFlowRun } from "../engine/run-job";
import { builtInRegistry } from "../nodes";
import type { NodeRegistry } from "../registry/registry";
import { recordFlowAudit } from "./audit";
import { FlowServiceError } from "./errors";
import {
  type FlowScope,
  getFlow,
  readDefinition,
  validateDefinition,
} from "./flows";

export type FlowRunRecord = Prisma.FlowRunGetPayload<object>;
export type FlowRunStepRecord = Prisma.FlowRunStepGetPayload<object>;
export type FlowRunItemRecord = Prisma.FlowRunItemGetPayload<object>;

type ManualInput = z.infer<typeof manualInputSchema>;

export interface RunScope {
  organizationId: string;
  runId: string;
}

const MANUAL_TRIGGER = "trigger.manual";
const TERMINAL_STATUSES = new Set([
  "SUCCEEDED",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELED",
]);

/** Fan-out rows read for edge counts; such rows are few (one per file). */
const FAN_OUT_ROW_LIMIT = 1000;

const runNotFound = () =>
  new FlowServiceError("RUN_NOT_FOUND", "Run not found.");

const invalidInput = (message: string) =>
  new FlowServiceError("INPUT_INVALID", message);

/** Unscoped lookup, for deciding which organization a run id belongs to. */
/**
 * Creates a run with the next number of its flow. An advisory lock on the
 * flow makes concurrent starts take numbers one at a time. A run a person
 * started is recorded in the audit log with it.
 */
export const createNumberedRun = (
  data: Omit<Prisma.FlowRunUncheckedCreateInput, "number">,
  audit?: { flowName: string; shopDomain: string }
): Promise<FlowRunRecord> =>
  prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.flowId}, 0))::text AS locked`;
    const last = await transaction.flowRun.aggregate({
      _max: { number: true },
      where: { flowId: data.flowId },
    });
    const run = await transaction.flowRun.create({
      data: { ...data, number: (last._max.number ?? 0) + 1 },
    });
    if (audit && data.startedById) {
      await recordFlowAudit(transaction, {
        action: "flow.run.started",
        actorId: data.startedById,
        metadata: {
          flowName: audit.flowName,
          runNumber: run.number,
          shopDomain: audit.shopDomain,
        },
        organizationId: data.organizationId,
        targetId: run.id,
        targetType: "FlowRun",
      });
    }
    return run;
  });

export const findRunById = (runId: string): Promise<FlowRunRecord | null> =>
  prisma.flowRun.findUnique({ where: { id: runId } });

const readInput = async (
  input: ManualInput,
  value: unknown,
  organizationId: string
): Promise<string | number> => {
  if (input.type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (value === "" || !Number.isFinite(number)) {
      throw invalidInput(`"${input.label}" must be a number.`);
    }
    return number;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw invalidInput(`"${input.label}" is required.`);
  }
  if (input.type === "file") {
    // The value is the id of an uploaded file, which must belong to the
    // same organization as the flow.
    const asset = await prisma.fileAsset.findFirst({
      select: { id: true },
      where: { deletedAt: null, id: value, organizationId },
    });
    if (!asset) {
      throw invalidInput(`The file for "${input.label}" could not be found.`);
    }
  }
  return value;
};

/** Checks the values a run is started with against the trigger's inputs. */
const readManualInputs = async (
  declared: ManualInput[],
  provided: Record<string, unknown>,
  organizationId: string
) => {
  const values: Record<string, string | number> = {};
  for (const input of declared) {
    values[input.key] = await readInput(
      input,
      provided[input.key],
      organizationId
    );
  }
  return values;
};

/**
 * Starts a run of the flow's current version against one store. The store and
 * any uploaded file must belong to the flow's organization, and the flow must
 * pass validation.
 */
export const startFlowRun = async (
  scope: FlowScope,
  input: {
    actorId: string;
    inputs?: Record<string, unknown> | undefined;
    storeId: string;
  },
  dependencies: { jobs: JobQueueProvider; registry?: NodeRegistry }
): Promise<FlowRunRecord> => {
  const registry = dependencies.registry ?? builtInRegistry;
  const { flow, version } = await getFlow(scope);
  if (!version) {
    throw new FlowServiceError(
      "FLOW_INVALID",
      "The flow has no saved version."
    );
  }
  if (flow.status === "ARCHIVED") {
    throw new FlowServiceError(
      "FLOW_INVALID",
      "An archived flow cannot be run."
    );
  }
  const definition = readDefinition(version);
  const validation = validateDefinition(definition, registry);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_INVALID",
      "The flow has problems that must be fixed before it can run.",
      validation.issues
    );
  }
  const store = await prisma.shopifyStore.findFirst({
    select: { id: true, shopDomain: true, status: true },
    where: { id: input.storeId, organizationId: scope.organizationId },
  });
  if (!store) {
    throw new FlowServiceError("STORE_NOT_AVAILABLE", "Store not found.");
  }
  if (store.status !== "CONNECTED") {
    throw new FlowServiceError(
      "STORE_NOT_AVAILABLE",
      "The store is not connected. Reconnect it before running a flow."
    );
  }

  const trigger = definition.nodes.find(
    (node) => registry.get(node.type)?.category === "trigger"
  );
  if (trigger?.type !== MANUAL_TRIGGER) {
    throw new FlowServiceError(
      "FLOW_INVALID",
      "This flow does not start manually."
    );
  }
  const declared = (
    registry.get(MANUAL_TRIGGER)?.configSchema.parse(trigger.config) as {
      inputs: ManualInput[];
    }
  ).inputs;
  const triggerPayload = await readManualInputs(
    declared,
    input.inputs ?? {},
    scope.organizationId
  );

  const run = await createNumberedRun(
    {
      flowId: flow.id,
      flowVersionId: version.id,
      organizationId: scope.organizationId,
      startedById: input.actorId,
      storeId: store.id,
      triggerPayload,
      triggerType: "manual",
    },
    { flowName: flow.name, shopDomain: store.shopDomain }
  );
  await enqueueFlowRun(dependencies.jobs, run);
  return run;
};

/**
 * Starts a run for an activated flow, without a person. The run uses the
 * version the flow was activated with, so later edits wait for reactivation.
 */
export const startTriggeredRun = async (
  activation: {
    flowId: string;
    flowVersionId: string;
    organizationId: string;
    storeId: string;
  },
  trigger: { payload: Record<string, unknown>; type: "webhook" | "schedule" },
  jobs: JobQueueProvider
): Promise<FlowRunRecord> => {
  const run = await createNumberedRun({
    flowId: activation.flowId,
    flowVersionId: activation.flowVersionId,
    organizationId: activation.organizationId,
    storeId: activation.storeId,
    triggerPayload: trigger.payload as Prisma.InputJsonObject,
    triggerType: trigger.type,
  });
  await enqueueFlowRun(jobs, run);
  return run;
};

/**
 * Asks a run to stop. The executor checks between items, so the item being
 * processed finishes and the rest stay pending.
 */
export const cancelFlowRun = async (
  scope: RunScope,
  actorId: string
): Promise<FlowRunRecord> => {
  const run = await prisma.flowRun.findFirst({
    include: { flow: { select: { name: true } } },
    where: { id: scope.runId, organizationId: scope.organizationId },
  });
  if (!run) {
    throw runNotFound();
  }
  if (TERMINAL_STATUSES.has(run.status)) {
    throw new FlowServiceError(
      "RUN_NOT_CANCELABLE",
      "The run has already finished."
    );
  }
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.flowRun.update({
      data: { cancelRequestedAt: run.cancelRequestedAt ?? new Date() },
      where: { id: run.id },
    });
    // Asking twice records one cancellation.
    if (!run.cancelRequestedAt) {
      await recordFlowAudit(transaction, {
        action: "flow.run.canceled",
        actorId,
        metadata: { flowName: run.flow.name, runNumber: run.number },
        organizationId: scope.organizationId,
        targetId: run.id,
        targetType: "FlowRun",
      });
    }
    return updated;
  });
};

export interface FlowRunListItem extends FlowRunRecord {
  flowName: string;
  /** Items of the run in each status, across all nodes. */
  itemCounts: Record<string, number>;
  startedByName: string | null;
  storeDomain: string;
  storeEnvironment: string;
  storeName: string;
}

/**
 * Runs newest first, of one flow or, without a flow id, of the whole
 * organization.
 */
export const listFlowRuns = async (
  scope: { flowId?: string | undefined; organizationId: string },
  page: { cursor?: string | undefined; limit: number }
): Promise<{ items: FlowRunListItem[]; nextCursor: string | null }> => {
  const rows = await prisma.flowRun.findMany({
    include: {
      flow: { select: { name: true } },
      store: { select: { environment: true, name: true, shopDomain: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    where: {
      organizationId: scope.organizationId,
      ...(scope.flowId ? { flowId: scope.flowId } : {}),
    },
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const runs = rows.slice(0, page.limit);
  const runIds = runs.map(({ id }) => id);
  const starterIds = [
    ...new Set(runs.map(({ startedById }) => startedById).filter(Boolean)),
  ] as string[];
  const [groups, starters] = await Promise.all([
    prisma.flowRunItem.groupBy({
      _count: { _all: true },
      by: ["runId", "status"],
      where: { runId: { in: runIds } },
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
      where: { id: { in: starterIds } },
    }),
  ]);
  const names = new Map(starters.map(({ id, name }) => [id, name]));
  const counts = new Map<string, Record<string, number>>();
  for (const group of groups) {
    const entry = counts.get(group.runId) ?? {};
    entry[group.status] = group._count._all;
    counts.set(group.runId, entry);
  }
  return {
    items: runs.map(({ flow, store, ...run }) => ({
      ...run,
      flowName: flow.name,
      itemCounts: counts.get(run.id) ?? {},
      startedByName: run.startedById
        ? (names.get(run.startedById) ?? null)
        : null,
      storeDomain: store.shopDomain,
      storeEnvironment: store.environment,
      storeName: store.name,
    })),
    nextCursor: rows.length > page.limit ? (runs.at(-1)?.id ?? null) : null,
  };
};

export interface RunNodeSummary {
  /** Items in each status at this node. */
  counts: Record<string, number>;
  /** Items the node sent out of each output handle. */
  emitted: Record<string, number>;
  step: FlowRunStepRecord | null;
}

/** A run with its steps and, per node, how many items are in each status. */
export const getFlowRun = async (
  scope: RunScope
): Promise<{ nodes: Record<string, RunNodeSummary>; run: FlowRunRecord }> => {
  const run = await prisma.flowRun.findFirst({
    where: { id: scope.runId, organizationId: scope.organizationId },
  });
  if (!run) {
    throw runNotFound();
  }
  const [steps, groups, routed, fannedOut] = await Promise.all([
    prisma.flowRunStep.findMany({ where: { runId: run.id } }),
    prisma.flowRunItem.groupBy({
      _count: { _all: true },
      by: ["nodeId", "status"],
      where: { runId: run.id },
    }),
    // Items that left by a single output handle.
    prisma.flowRunItem.groupBy({
      _count: { _all: true },
      by: ["nodeId", "outputHandle"],
      where: {
        outputHandle: { not: null },
        runId: run.id,
        status: "SUCCEEDED",
      },
    }),
    // Items that became several; each records how many left by each handle.
    prisma.flowRunItem.findMany({
      select: { nodeId: true, output: true },
      take: FAN_OUT_ROW_LIMIT,
      where: { outputHandle: null, runId: run.id, status: "SUCCEEDED" },
    }),
  ]);
  const nodes: Record<string, RunNodeSummary> = {};
  const summaryOf = (nodeId: string) => {
    nodes[nodeId] ??= { counts: {}, emitted: {}, step: null };
    return nodes[nodeId];
  };
  const addEmitted = (nodeId: string, handle: string, count: number) => {
    const { emitted } = summaryOf(nodeId);
    emitted[handle] = (emitted[handle] ?? 0) + count;
  };
  for (const step of steps) {
    summaryOf(step.nodeId).step = step;
  }
  for (const group of groups) {
    summaryOf(group.nodeId).counts[group.status] = group._count._all;
  }
  for (const group of routed) {
    if (group.outputHandle) {
      addEmitted(group.nodeId, group.outputHandle, group._count._all);
    }
  }
  for (const item of fannedOut) {
    const handles = (item.output as { handles?: Record<string, number> } | null)
      ?.handles;
    for (const [handle, count] of Object.entries(handles ?? {})) {
      addEmitted(item.nodeId, handle, count);
    }
  }
  return { nodes, run };
};

export const listFlowRunItems = async (
  scope: RunScope,
  filter: {
    cursor?: string | undefined;
    limit: number;
    nodeId?: string | undefined;
    status?: FlowRunItemRecord["status"] | undefined;
  }
): Promise<{ items: FlowRunItemRecord[]; nextCursor: string | null }> => {
  const run = await prisma.flowRun.findFirst({
    select: { id: true },
    where: { id: scope.runId, organizationId: scope.organizationId },
  });
  if (!run) {
    throw runNotFound();
  }
  const rows = await prisma.flowRunItem.findMany({
    orderBy: { ordinal: "asc" },
    take: filter.limit + 1,
    where: {
      runId: run.id,
      ...(filter.nodeId ? { nodeId: filter.nodeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, filter.limit);
  return {
    items,
    nextCursor: rows.length > filter.limit ? (items.at(-1)?.id ?? null) : null,
  };
};
