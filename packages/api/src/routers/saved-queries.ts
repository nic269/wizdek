import { hasPermission } from "@repo/auth/permissions";
import { prisma } from "@repo/database";
import { ApiError } from "../errors";
import { requireOrganizationAccess } from "./authz";
import { os } from "./implementer";

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

const nameTaken = () =>
  new ApiError("CONFLICT", "A saved query with this name already exists.", 409);

const requireReader = (headers: Headers, organizationId: string) =>
  requireOrganizationAccess(headers, organizationId, "graphql", "query");

/**
 * Saved queries are shared, so changing one is limited to its creator and to
 * people who manage the organization's stores.
 */
const requireEditable = async (
  headers: Headers,
  input: { organizationId: string; savedQueryId: string }
) => {
  const user = await requireReader(headers, input.organizationId);
  const savedQuery = await prisma.savedGraphqlQuery.findFirst({
    where: { id: input.savedQueryId, organizationId: input.organizationId },
  });
  if (!savedQuery) {
    throw new ApiError("NOT_FOUND", "Saved query not found.", 404);
  }
  const canEdit =
    savedQuery.createdById === user.id ||
    (await hasPermission({
      action: "manage",
      module: "stores",
      organizationId: input.organizationId,
      userId: user.id,
    }));
  if (!canEdit) {
    throw new ApiError(
      "FORBIDDEN",
      "Only the person who saved this query or a store manager can change it.",
      403
    );
  }
  return savedQuery;
};

export const savedQueriesRouter = {
  create: os.savedQueries.create.handler(async ({ context, input }) => {
    const user = await requireReader(context.headers, input.organizationId);
    try {
      return {
        data: await prisma.savedGraphqlQuery.create({
          data: {
            createdById: user.id,
            name: input.name,
            organizationId: input.organizationId,
            query: input.query,
            variables: input.variables ?? null,
          },
        }),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw nameTaken();
      }
      throw error;
    }
  }),
  delete: os.savedQueries.delete.handler(async ({ context, input }) => {
    const savedQuery = await requireEditable(context.headers, input);
    await prisma.savedGraphqlQuery.delete({ where: { id: savedQuery.id } });
  }),
  list: os.savedQueries.list.handler(async ({ context, input }) => {
    await requireReader(context.headers, input.organizationId);
    return {
      data: await prisma.savedGraphqlQuery.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: { organizationId: input.organizationId },
      }),
    };
  }),
  update: os.savedQueries.update.handler(async ({ context, input }) => {
    const savedQuery = await requireEditable(context.headers, input);
    try {
      return {
        data: await prisma.savedGraphqlQuery.update({
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.query === undefined ? {} : { query: input.query }),
            ...(input.variables === undefined
              ? {}
              : { variables: input.variables }),
          },
          where: { id: savedQuery.id },
        }),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw nameTaken();
      }
      throw error;
    }
  }),
};
