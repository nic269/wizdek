import { type Prisma, prisma } from "@repo/database";
import {
  emptyFlowDefinition,
  type FlowDefinition,
  flowDefinitionSchema,
} from "../definition/schema";
import {
  type FlowValidationResult,
  validateFlowDefinition,
} from "../definition/validate";
import { builtInRegistry } from "../nodes";
import type { NodeRegistry } from "../registry/registry";
import { FlowServiceError } from "./errors";

export type FlowRecord = Prisma.FlowGetPayload<object>;
export type FlowVersionRecord = Prisma.FlowVersionGetPayload<object>;

export interface FlowScope {
  flowId: string;
  organizationId: string;
}

export interface FlowWithVersion {
  flow: FlowRecord;
  /** Null only for a flow whose current version row is missing. */
  version: FlowVersionRecord | null;
}

/** Definitions are plain JSON; this only satisfies the JSON column's type. */
const toJson = (definition: FlowDefinition) =>
  definition as unknown as Prisma.InputJsonObject;

const flowNotFound = () =>
  new FlowServiceError("FLOW_NOT_FOUND", "Flow not found.");

/** Unscoped lookup, for deciding which organization a flow id belongs to. */
export const findFlowById = (flowId: string): Promise<FlowRecord | null> =>
  prisma.flow.findUnique({ where: { id: flowId } });

export interface FlowListItem extends FlowRecord {
  lastRun: { createdAt: Date; id: string; status: string } | null;
}

export const listFlows = async (
  organizationId: string
): Promise<FlowListItem[]> => {
  const flows = await prisma.flow.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    where: { organizationId },
  });
  const lastRuns = await prisma.flowRun.findMany({
    distinct: ["flowId"],
    orderBy: [{ flowId: "asc" }, { createdAt: "desc" }],
    select: { createdAt: true, flowId: true, id: true, status: true },
    where: { organizationId },
  });
  const byFlow = new Map(lastRuns.map((run) => [run.flowId, run]));
  return flows.map((flow) => {
    const run = byFlow.get(flow.id);
    return {
      ...flow,
      lastRun: run
        ? { createdAt: run.createdAt, id: run.id, status: run.status }
        : null,
    };
  });
};

export const getFlow = async (scope: FlowScope): Promise<FlowWithVersion> => {
  const flow = await prisma.flow.findFirst({
    where: { id: scope.flowId, organizationId: scope.organizationId },
  });
  if (!flow) {
    throw flowNotFound();
  }
  const version = flow.currentVersionId
    ? await prisma.flowVersion.findUnique({
        where: { id: flow.currentVersionId },
      })
    : null;
  return { flow, version };
};

/** Reads a stored definition, which was validated for shape when it was saved. */
export const readDefinition = (version: FlowVersionRecord): FlowDefinition =>
  flowDefinitionSchema.parse(version.definition);

export const validateDefinition = (
  definition: FlowDefinition,
  registry: NodeRegistry = builtInRegistry
): FlowValidationResult => validateFlowDefinition(definition, registry.list());

/** Creates a flow with an empty first version. */
export const createFlow = (input: {
  actorId: string;
  description?: string | undefined;
  name: string;
  organizationId: string;
}): Promise<FlowWithVersion> =>
  prisma.$transaction(async (transaction) => {
    const flow = await transaction.flow.create({
      data: {
        createdById: input.actorId,
        description: input.description?.trim() || null,
        name: input.name.trim(),
        organizationId: input.organizationId,
      },
    });
    const version = await transaction.flowVersion.create({
      data: {
        createdById: input.actorId,
        definition: toJson(emptyFlowDefinition()),
        flowId: flow.id,
        version: 1,
      },
    });
    return {
      flow: await transaction.flow.update({
        data: { currentVersionId: version.id },
        where: { id: flow.id },
      }),
      version,
    };
  });

export const updateFlow = async (
  scope: FlowScope,
  changes: {
    description?: string | null | undefined;
    name?: string | undefined;
    status?: FlowRecord["status"] | undefined;
  }
): Promise<FlowRecord> => {
  const { count } = await prisma.flow.updateMany({
    data: {
      ...(changes.description === undefined
        ? {}
        : { description: changes.description?.trim() || null }),
      ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
      ...(changes.status === undefined ? {} : { status: changes.status }),
    },
    where: { id: scope.flowId, organizationId: scope.organizationId },
  });
  if (count === 0) {
    throw flowNotFound();
  }
  return prisma.flow.findUniqueOrThrow({ where: { id: scope.flowId } });
};

/**
 * Saves the definition as a new immutable version. `baseVersion` is the
 * version the editor loaded; when someone else has saved since, the save is
 * refused instead of overwriting their work. A draft may be saved while it
 * still has validation issues; they are returned with it.
 */
export const saveFlowVersion = (
  scope: FlowScope,
  input: { actorId: string; baseVersion: number; definition: unknown },
  registry: NodeRegistry = builtInRegistry
): Promise<{
  flow: FlowRecord;
  validation: FlowValidationResult;
  version: FlowVersionRecord;
}> => {
  const parsed = flowDefinitionSchema.safeParse(input.definition);
  if (!parsed.success) {
    return Promise.reject(
      new FlowServiceError(
        "DEFINITION_INVALID",
        `The flow definition is malformed: ${parsed.error.issues[0]?.message ?? "invalid data"}.`
      )
    );
  }
  const definition = parsed.data;

  return prisma.$transaction(async (transaction) => {
    // Locks the flow row so two saves cannot both pass the version check.
    const locked = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id FROM flow
      WHERE id = ${scope.flowId} AND "organizationId" = ${scope.organizationId}
      FOR UPDATE`;
    if (locked.length === 0) {
      throw flowNotFound();
    }
    const latest = await transaction.flowVersion.findFirst({
      orderBy: { version: "desc" },
      select: { version: true },
      where: { flowId: scope.flowId },
    });
    const currentVersion = latest?.version ?? 0;
    if (currentVersion !== input.baseVersion) {
      throw new FlowServiceError(
        "VERSION_CONFLICT",
        "This flow was changed by someone else. Reload it before saving."
      );
    }
    const version = await transaction.flowVersion.create({
      data: {
        createdById: input.actorId,
        definition: toJson(definition),
        flowId: scope.flowId,
        version: currentVersion + 1,
      },
    });
    const flow = await transaction.flow.update({
      data: { currentVersionId: version.id },
      where: { id: scope.flowId },
    });
    return {
      flow,
      validation: validateDefinition(definition, registry),
      version,
    };
  });
};
