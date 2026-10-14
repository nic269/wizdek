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
  lastRun: {
    createdAt: Date;
    id: string;
    number: number;
    status: string;
    storeName: string;
  } | null;
  /** How many steps the current version has, its trigger included. */
  stepCount: number;
  /** The current version's trigger node type, or null without one. */
  triggerType: string | null;
  /** The current version number, or null before the first save. */
  version: number | null;
}

const triggerOf = (
  definition: FlowDefinition,
  registry: NodeRegistry
): string | null =>
  definition.nodes.find(
    (node) => registry.get(node.type)?.category === "trigger"
  )?.type ?? null;

export const listFlows = async (
  organizationId: string,
  registry: NodeRegistry = builtInRegistry
): Promise<FlowListItem[]> => {
  const flows = await prisma.flow.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    where: { organizationId },
  });
  const versionIds = flows
    .map(({ currentVersionId }) => currentVersionId)
    .filter((id): id is string => Boolean(id));
  const [lastRuns, versions] = await Promise.all([
    prisma.flowRun.findMany({
      distinct: ["flowId"],
      orderBy: [{ flowId: "asc" }, { createdAt: "desc" }],
      select: {
        createdAt: true,
        flowId: true,
        id: true,
        number: true,
        status: true,
        store: { select: { name: true } },
      },
      where: { organizationId },
    }),
    prisma.flowVersion.findMany({
      select: { definition: true, id: true, version: true },
      where: { id: { in: versionIds } },
    }),
  ]);
  const runByFlow = new Map(lastRuns.map((run) => [run.flowId, run]));
  const versionById = new Map(versions.map((version) => [version.id, version]));
  return flows.map((flow) => {
    const run = runByFlow.get(flow.id);
    const version = flow.currentVersionId
      ? versionById.get(flow.currentVersionId)
      : undefined;
    const definition = version
      ? flowDefinitionSchema.safeParse(version.definition)
      : undefined;
    const nodes = definition?.success ? definition.data : undefined;
    return {
      ...flow,
      lastRun: run
        ? {
            createdAt: run.createdAt,
            id: run.id,
            number: run.number,
            status: run.status,
            storeName: run.store.name,
          }
        : null,
      stepCount: nodes?.nodes.length ?? 0,
      triggerType: nodes ? triggerOf(nodes, registry) : null,
      version: version?.version ?? null,
    };
  });
};

export interface FlowVersionListItem {
  createdAt: Date;
  createdByName: string | null;
  id: string;
  version: number;
}

/** A flow's saved versions, newest first. */
export const listFlowVersions = async (
  scope: FlowScope,
  limit = 20
): Promise<FlowVersionListItem[]> => {
  const versions = await prisma.flowVersion.findMany({
    orderBy: { version: "desc" },
    select: { createdAt: true, createdById: true, id: true, version: true },
    take: limit,
    where: {
      flow: { id: scope.flowId, organizationId: scope.organizationId },
    },
  });
  const authorIds = [
    ...new Set(versions.map(({ createdById }) => createdById).filter(Boolean)),
  ] as string[];
  const authors = await prisma.user.findMany({
    select: { id: true, name: true },
    where: { id: { in: authorIds } },
  });
  const names = new Map(authors.map(({ id, name }) => [id, name]));
  return versions.map(({ createdById, ...version }) => ({
    ...version,
    createdByName: createdById ? (names.get(createdById) ?? null) : null,
  }));
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
