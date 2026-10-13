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

export const requirePermission = async (input: PermissionInput) => {
  const allowed = await hasPermission(input);
  if (!allowed) {
    throw new Error(`Missing permission ${input.module}:${input.action}`);
  }
};
