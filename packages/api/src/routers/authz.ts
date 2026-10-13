import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { prisma } from "@repo/database";
import { findStoreById, type ShopifyStoreRecord } from "@repo/shopify/stores";
import { ApiError } from "../errors";

export const requireUser = async (headers: Headers) => {
  const session = await getCurrentSession(headers);
  if (!session) {
    throw new ApiError("UNAUTHORIZED", "Authentication required.", 401);
  }
  return session.user;
};

export const requireOrganizationPermission = async (
  userId: string,
  organizationId: string,
  module: string,
  action: string,
  message = "You do not have permission for this organization action."
) => {
  if (!(await hasPermission({ action, module, organizationId, userId }))) {
    throw new ApiError("FORBIDDEN", message, 403);
  }
};

/** Requires a session and one permission in the given organization. */
export const requireOrganizationAccess = async (
  headers: Headers,
  organizationId: string,
  module: string,
  action: string
) => {
  const user = await requireUser(headers);
  await requireOrganizationPermission(user.id, organizationId, module, action);
  return user;
};

const storeNotFound = () => new ApiError("NOT_FOUND", "Store not found.", 404);

/**
 * Authorizes an action on a store. The organization always comes from the
 * store row, never from input. A store that is missing or belongs to an
 * organization the caller is not an active member of answers 404, so its
 * existence is not revealed; a member lacking the permission answers 403.
 */
export const requireStorePermission = async (
  headers: Headers,
  storeId: string,
  module: string,
  action: string
): Promise<{
  store: ShopifyStoreRecord;
  user: Awaited<ReturnType<typeof requireUser>>;
}> => {
  const user = await requireUser(headers);
  const store = await findStoreById(storeId);
  if (!store) {
    throw storeNotFound();
  }
  const { organizationId } = store;
  if (
    await hasPermission({ action, module, organizationId, userId: user.id })
  ) {
    return { store, user };
  }
  const membership = await prisma.membership.findUnique({
    select: { status: true },
    where: { userId_organizationId: { organizationId, userId: user.id } },
  });
  if (membership?.status !== "ACTIVE") {
    throw storeNotFound();
  }
  throw new ApiError(
    "FORBIDDEN",
    "You do not have permission for this store action.",
    403
  );
};
