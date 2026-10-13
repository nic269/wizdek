import {
  normalizePermissions,
  type PermissionInput,
} from "@repo/access-control";
import { type Prisma, prisma } from "@repo/database";
import { isRetryableTransactionConflict } from "@repo/database/transaction-conflicts";
import { cursorDate, decodeCursor, type PageInput, toPage } from "./pagination";

const OWNER_ROLE_NAME = "Owner";
const MAX_OWNER_UPDATE_ATTEMPTS = 3;

export type AccessControlErrorCode =
  | "LAST_OWNER_REQUIRED"
  | "MEMBERSHIP_NOT_FOUND"
  | "OWNER_ROLE_REQUIRES_OWNER"
  | "OWNER_UPDATE_CONFLICT"
  | "ROLE_NOT_FOUND";

export class AccessControlError extends Error {
  readonly code: AccessControlErrorCode;

  constructor(code: AccessControlErrorCode) {
    super(code);
    this.code = code;
  }
}

const isSystemOwnerRole = (role?: { isSystem: boolean; name: string } | null) =>
  role?.isSystem === true && role.name === OWNER_ROLE_NAME;

interface UpdateMemberRoleInput {
  actorId: string;
  membershipId: string;
  organizationId: string;
  roleId: string;
}

const requireOwnerBoundaryActor = async (
  transaction: Prisma.TransactionClient,
  input: UpdateMemberRoleInput
) => {
  const authorizedActor = await transaction.user.findFirst({
    select: { id: true },
    where: {
      id: input.actorId,
      OR: [
        { isSuperAdmin: true },
        {
          memberships: {
            some: {
              organizationId: input.organizationId,
              role: { isSystem: true, name: OWNER_ROLE_NAME },
              status: "ACTIVE",
            },
          },
        },
      ],
      status: "ACTIVE",
    },
  });
  if (!authorizedActor) {
    throw new AccessControlError("OWNER_ROLE_REQUIRES_OWNER");
  }
};

const requireRemainingOwner = async (
  transaction: Prisma.TransactionClient,
  input: UpdateMemberRoleInput
) => {
  const remainingOwnerCount = await transaction.membership.count({
    where: {
      id: { not: input.membershipId },
      organizationId: input.organizationId,
      role: { isSystem: true, name: OWNER_ROLE_NAME },
      status: "ACTIVE",
    },
  });
  if (remainingOwnerCount === 0) {
    throw new AccessControlError("LAST_OWNER_REQUIRED");
  }
};

const updateMemberRoleInTransaction = async (
  transaction: Prisma.TransactionClient,
  input: UpdateMemberRoleInput
) => {
  const role = await transaction.role.findFirst({
    select: { id: true, isSystem: true, name: true },
    where: { id: input.roleId, organizationId: input.organizationId },
  });
  if (!role) {
    throw new AccessControlError("ROLE_NOT_FOUND");
  }

  const membership = await transaction.membership.findFirst({
    select: {
      id: true,
      role: { select: { isSystem: true, name: true } },
    },
    where: {
      id: input.membershipId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
  });
  if (!membership) {
    throw new AccessControlError("MEMBERSHIP_NOT_FOUND");
  }

  const membershipIsOwner = isSystemOwnerRole(membership.role);
  const targetRoleIsOwner = isSystemOwnerRole(role);
  if (membershipIsOwner !== targetRoleIsOwner) {
    await requireOwnerBoundaryActor(transaction, input);
  }
  if (membershipIsOwner && !targetRoleIsOwner) {
    await requireRemainingOwner(transaction, input);
  }

  const result = await transaction.membership.updateMany({
    data: { roleId: role.id },
    where: {
      id: input.membershipId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
  });
  if (result.count === 0) {
    throw new AccessControlError("MEMBERSHIP_NOT_FOUND");
  }

  await transaction.auditLog.create({
    data: {
      action: "member.role_updated",
      actorId: input.actorId,
      metadata: { roleId: role.id, roleName: role.name },
      organizationId: input.organizationId,
      targetId: input.membershipId,
      targetType: "Membership",
    },
  });
};

export {
  isKnownPermission,
  MEMBER_PERMISSIONS,
  OWNER_PERMISSIONS,
  PERMISSION_CATALOG,
  type PermissionDefinition,
  type PermissionInput,
} from "@repo/access-control";
export { PaginationCursorError } from "./pagination";

export const listRoles = async (input: PageInput) => {
  const cursor = decodeCursor(input.cursor, "roles");
  const rows = await prisma.role.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      _count: { select: { memberships: true } },
      description: true,
      id: true,
      name: true,
      permissions: {
        orderBy: [{ module: "asc" }, { action: "asc" }],
        select: { action: true, module: true },
      },
    },
    take: input.limit + 1,
    where: {
      organizationId: input.organizationId,
      ...(cursor
        ? {
            OR: [
              { name: { gt: cursor.sort } },
              { id: { gt: cursor.id }, name: cursor.sort },
            ],
          }
        : {}),
    },
  });
  return toPage(rows, input.limit, (role) => ({
    id: role.id,
    kind: "roles",
    sort: role.name,
  }));
};

export const createRole = (input: {
  organizationId: string;
  name: string;
  description?: string;
  permissions: PermissionInput[];
  actorId: string;
}) =>
  prisma.$transaction(async (transaction) => {
    const permissions = normalizePermissions(input.permissions);
    const role = await transaction.role.create({
      data: {
        description: input.description?.trim() || null,
        name: input.name.trim(),
        organizationId: input.organizationId,
        permissions: { createMany: { data: permissions } },
      },
      select: {
        _count: { select: { memberships: true } },
        description: true,
        id: true,
        name: true,
        permissions: {
          orderBy: [{ module: "asc" }, { action: "asc" }],
          select: { action: true, module: true },
        },
      },
    });

    const permissionMetadata = permissions.map(({ module, action }) => ({
      action,
      module,
    }));

    await transaction.auditLog.create({
      data: {
        action: "role.created",
        actorId: input.actorId,
        metadata: { name: role.name, permissions: permissionMetadata },
        organizationId: input.organizationId,
        targetId: role.id,
        targetType: "Role",
      },
    });

    return role;
  });

export const listMembers = async (input: PageInput) => {
  const cursor = decodeCursor(input.cursor, "members");
  const cursorCreatedAt = cursor ? cursorDate(cursor.sort) : undefined;
  const rows = await prisma.membership.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      createdAt: true,
      id: true,
      role: { select: { id: true, name: true } },
      status: true,
      user: { select: { email: true, id: true, name: true } },
    },
    take: input.limit + 1,
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      ...(cursor && cursorCreatedAt
        ? {
            OR: [
              { createdAt: { gt: cursorCreatedAt } },
              { createdAt: cursorCreatedAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
  });
  return toPage(rows, input.limit, (membership) => ({
    id: membership.id,
    kind: "members",
    sort: membership.createdAt.toISOString(),
  }));
};

export const updateMemberRole = async (input: UpdateMemberRoleInput) => {
  for (let attempt = 1; attempt <= MAX_OWNER_UPDATE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        (transaction) => updateMemberRoleInTransaction(transaction, input),
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) {
        throw error;
      }
      if (attempt === MAX_OWNER_UPDATE_ATTEMPTS) {
        throw new AccessControlError("OWNER_UPDATE_CONFLICT");
      }
    }
  }
};

export const listAuditLogs = async (input: PageInput) => {
  const cursor = decodeCursor(input.cursor, "audit-logs");
  const cursorCreatedAt = cursor ? cursorDate(cursor.sort) : undefined;
  const rows = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      action: true,
      actor: { select: { email: true, name: true } },
      createdAt: true,
      id: true,
      metadata: true,
      targetId: true,
      targetType: true,
    },
    take: input.limit + 1,
    where: {
      organizationId: input.organizationId,
      ...(cursor && cursorCreatedAt
        ? {
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              { createdAt: cursorCreatedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
  });
  return toPage(rows, input.limit, (auditLog) => ({
    id: auditLog.id,
    kind: "audit-logs",
    sort: auditLog.createdAt.toISOString(),
  }));
};
