import type { Prisma } from "@prisma/client";
import { ROLE_PERMISSION_PRESETS } from "@repo/access-control";

export const SYSTEM_ROLE_DESCRIPTIONS = {
  Admin: "Administrative access to organization resources.",
  Member: "Standard organization member access.",
  Owner: "Full access to organization settings and members.",
  Viewer: "Read-only access to organization resources.",
} as const;

export type SystemRoleName = keyof typeof ROLE_PERMISSION_PRESETS;

export const syncSystemRoles = async (
  transaction: Prisma.TransactionClient,
  organizationId: string
) => {
  const roles = {} as Record<SystemRoleName, { id: string; name: string }>;
  const roleNames = Object.keys(ROLE_PERMISSION_PRESETS) as SystemRoleName[];

  for (const name of roleNames) {
    const role = await transaction.role.upsert({
      create: {
        description: SYSTEM_ROLE_DESCRIPTIONS[name],
        isSystem: true,
        name,
        organizationId,
      },
      select: { id: true, name: true },
      update: {
        description: SYSTEM_ROLE_DESCRIPTIONS[name],
        isSystem: true,
      },
      where: { organizationId_name: { name, organizationId } },
    });

    await transaction.rolePermission.deleteMany({ where: { roleId: role.id } });
    await transaction.rolePermission.createMany({
      data: ROLE_PERMISSION_PRESETS[name].map((permission) => ({
        ...permission,
        roleId: role.id,
      })),
    });
    roles[name] = role;
  }

  return roles;
};
