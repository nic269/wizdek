import { type Prisma, prisma } from "@repo/database";
import { recordFunctionAudit } from "../audit";
import { aliasOf, GRANT_ALIAS, type GrantKind } from "../definition";
import { FunctionsError } from "../errors";
import { type FunctionScope, getFunction } from "./functions";

export type CodeFunctionGrantRecord =
  Prisma.CodeFunctionGrantGetPayload<object>;

/** A grant with what the editor shows of its resource. */
export interface GrantSummary extends CodeFunctionGrantRecord {
  /** The store's domain or the connection's database; null once deleted. */
  detail: string | null;
  /** The resource's name; null once it was deleted. */
  resourceName: string | null;
}

export const grantNotFound = () =>
  new FunctionsError("GRANT_NOT_FOUND", "Connection grant not found.");

const resourceLabel = (kind: GrantKind) =>
  kind === "STORE" ? "store" : "database connection";

/** The resources of an organization a grant may point at, by id. */
const resourcesOf = async (
  organizationId: string,
  grants: readonly Pick<CodeFunctionGrantRecord, "kind" | "resourceId">[]
) => {
  const idsOf = (kind: GrantKind) =>
    grants.filter((grant) => grant.kind === kind).map((g) => g.resourceId);
  const [stores, databases] = await Promise.all([
    prisma.shopifyStore.findMany({
      select: { id: true, name: true, shopDomain: true },
      where: { id: { in: idsOf("STORE") }, organizationId },
    }),
    prisma.databaseConnection.findMany({
      select: { databaseName: true, environment: true, id: true, name: true },
      where: { id: { in: idsOf("DATABASE") }, organizationId },
    }),
  ]);
  return new Map<string, { detail: string; name: string }>([
    ...stores.map(
      (store) =>
        [
          `STORE:${store.id}`,
          { detail: store.shopDomain, name: store.name },
        ] as const
    ),
    ...databases.map(
      (database) =>
        [
          `DATABASE:${database.id}`,
          {
            detail: `${database.environment} · ${database.databaseName}`,
            name: database.name,
          },
        ] as const
    ),
  ]);
};

/** A function's grants, by alias, with their resources' names. */
export const listGrants = async (
  scope: FunctionScope
): Promise<GrantSummary[]> => {
  const fn = await getFunction(scope);
  const grants = await prisma.codeFunctionGrant.findMany({
    orderBy: { alias: "asc" },
    where: { functionId: fn.id },
  });
  const resources = await resourcesOf(fn.organizationId, grants);
  return grants.map((grant) => {
    const resource = resources.get(`${grant.kind}:${grant.resourceId}`);
    return {
      ...grant,
      detail: resource?.detail ?? null,
      resourceName: resource?.name ?? null,
    };
  });
};

/** Unscoped lookup, for deciding which organization a grant belongs to. */
export const findGrantById = (grantId: string) =>
  prisma.codeFunctionGrant.findUnique({
    include: { function: true },
    where: { id: grantId },
  });

/**
 * Lets a function use a store or database connection of its organization.
 * The caller has already checked that the person may use the resource.
 */
export const addGrant = async (
  input: FunctionScope & {
    actorId: string;
    alias?: string | undefined;
    kind: GrantKind;
    resourceId: string;
  }
): Promise<GrantSummary> => {
  const fn = await getFunction(input);
  const [resource] = [
    ...(
      await resourcesOf(fn.organizationId, [
        { kind: input.kind, resourceId: input.resourceId },
      ])
    ).values(),
  ];
  if (!resource) {
    throw new FunctionsError(
      "INVALID_GRANT",
      `That ${resourceLabel(input.kind)} does not exist in this organization.`
    );
  }
  const alias = input.alias?.trim() || aliasOf(resource.name);
  if (!GRANT_ALIAS.test(alias)) {
    throw new FunctionsError(
      "INVALID_GRANT",
      "Use 1 to 40 lower-case letters, digits and dashes for the alias, starting with a letter or digit."
    );
  }
  const taken = await prisma.codeFunctionGrant.findFirst({
    select: { alias: true, resourceId: true },
    where: {
      functionId: fn.id,
      OR: [{ alias }, { kind: input.kind, resourceId: input.resourceId }],
    },
  });
  if (taken) {
    throw new FunctionsError(
      "INVALID_GRANT",
      taken.alias === alias
        ? `The alias ${alias} is already used by this function.`
        : `This function can already use that ${resourceLabel(input.kind)}.`
    );
  }
  const grant = await prisma.$transaction(async (db) => {
    const created = await db.codeFunctionGrant.create({
      data: {
        alias,
        createdById: input.actorId,
        functionId: fn.id,
        kind: input.kind,
        resourceId: input.resourceId,
      },
    });
    await recordFunctionAudit(db, {
      action: "function.grant.added",
      actorId: input.actorId,
      metadata: {
        alias,
        kind: input.kind,
        name: fn.name,
        resourceId: input.resourceId,
        resourceName: resource.name,
      },
      organizationId: fn.organizationId,
      targetId: fn.id,
      targetType: "CodeFunction",
    });
    return created;
  });
  return { ...grant, detail: resource.detail, resourceName: resource.name };
};

export const removeGrant = async (input: {
  actorId: string;
  grantId: string;
  organizationId: string;
}): Promise<void> => {
  const grant = await findGrantById(input.grantId);
  if (grant?.function.organizationId !== input.organizationId) {
    throw grantNotFound();
  }
  await prisma.$transaction(async (db) => {
    await db.codeFunctionGrant.delete({ where: { id: grant.id } });
    await recordFunctionAudit(db, {
      action: "function.grant.removed",
      actorId: input.actorId,
      metadata: {
        alias: grant.alias,
        kind: grant.kind,
        name: grant.function.name,
        resourceId: grant.resourceId,
      },
      organizationId: grant.function.organizationId,
      targetId: grant.functionId,
      targetType: "CodeFunction",
    });
  });
};

/** Removes every grant of a store or connection that is being deleted. */
export const removeGrantsOf = async (
  kind: GrantKind,
  resourceId: string
): Promise<void> => {
  await prisma.codeFunctionGrant.deleteMany({ where: { kind, resourceId } });
};

/**
 * The grant a function's code names by alias, or by the resource's id.
 * Null when the function may not use it.
 */
export const resolveGrant = (
  functionId: string,
  kind: GrantKind,
  name: string
): Promise<CodeFunctionGrantRecord | null> =>
  prisma.codeFunctionGrant.findFirst({
    where: { functionId, kind, OR: [{ alias: name }, { resourceId: name }] },
  });

/** A function's granted aliases by kind, for the code's `list()` helpers. */
export const grantedAliases = async (functionId: string) => {
  const grants = await prisma.codeFunctionGrant.findMany({
    orderBy: { alias: "asc" },
    select: { alias: true, kind: true },
    where: { functionId },
  });
  return {
    databases: grants.filter((g) => g.kind === "DATABASE").map((g) => g.alias),
    stores: grants.filter((g) => g.kind === "STORE").map((g) => g.alias),
  };
};
