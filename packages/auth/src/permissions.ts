import { PERMISSION_CATALOG } from "@repo/access-control";
import { prisma } from "@repo/database";

export interface PermissionInput {
  action: string;
  module: string;
  organizationId: string;
  userId: string;
}

export const hasPermission = async (
  input: PermissionInput
): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    select: { isSuperAdmin: true, status: true },
    where: { id: input.userId },
  });

  if (user?.status !== "ACTIVE") {
    return false;
  }

  if (user.isSuperAdmin) {
    return true;
  }

  const membership = await prisma.membership.findUnique({
    select: {
      role: {
        select: {
          permissions: {
            select: { id: true },
            where: {
              action: input.action,
              module: input.module,
            },
          },
        },
      },
      status: true,
    },
    where: {
      userId_organizationId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });

  return (
    membership?.status === "ACTIVE" &&
    Boolean(membership.role?.permissions.length)
  );
};

/**
 * Every permission the user holds in the organization, as `module:action`.
 * A super admin holds all of them; someone who is not an active member, none.
 */
export const listPermissions = async (input: {
  organizationId: string;
  userId: string;
}): Promise<string[]> => {
  const user = await prisma.user.findUnique({
    select: { isSuperAdmin: true, status: true },
    where: { id: input.userId },
  });
  if (user?.status !== "ACTIVE") {
    return [];
  }
  if (user.isSuperAdmin) {
    return PERMISSION_CATALOG.map(
      ({ action, module }) => `${module}:${action}`
    );
  }
  const membership = await prisma.membership.findUnique({
    select: {
      role: {
        select: { permissions: { select: { action: true, module: true } } },
      },
      status: true,
    },
    where: {
      userId_organizationId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (membership?.status !== "ACTIVE") {
    return [];
  }
  return (membership.role?.permissions ?? []).map(
    ({ action, module }) => `${module}:${action}`
  );
};

export const requirePermission = async (input: PermissionInput) => {
  const allowed = await hasPermission(input);
  if (!allowed) {
    throw new Error(`Missing permission ${input.module}:${input.action}`);
  }
};
