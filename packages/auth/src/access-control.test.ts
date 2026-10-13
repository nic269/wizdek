import { prisma } from "@repo/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRole,
  isKnownPermission,
  listAuditLogs,
  listMembers,
  listRoles,
  updateMemberRole,
} from "./access-control";

vi.mock("@repo/database", () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: { findMany: vi.fn() },
    membership: { findMany: vi.fn() },
    role: { create: vi.fn(), findMany: vi.fn() },
  },
}));

describe("access control service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts only catalog permissions", () => {
    expect(isKnownPermission({ action: "manage", module: "roles" })).toBe(true);
    expect(isKnownPermission({ action: "delete", module: "billing" })).toBe(
      false
    );
  });

  it("scopes role, member, and audit queries to one organization", async () => {
    vi.mocked(prisma.role.findMany).mockResolvedValue([]);
    vi.mocked(prisma.membership.findMany).mockResolvedValue([]);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

    await listRoles({ limit: 20, organizationId: "org-1" });
    await listMembers({ limit: 20, organizationId: "org-1" });
    await listAuditLogs({ limit: 20, organizationId: "org-1" });

    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        where: { organizationId: "org-1" },
      })
    );
    expect(prisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        where: { organizationId: "org-1", status: "ACTIVE" },
      })
    );
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        where: { organizationId: "org-1" },
      })
    );
  });

  it("creates roles with catalog permissions and audit evidence transactionally", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      role: {
        create: vi.fn().mockResolvedValue({
          _count: { memberships: 0 },
          description: null,
          id: "role-1",
          name: "Manager",
          permissions: [{ action: "read", module: "members" }],
        }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await createRole({
      actorId: "owner-1",
      name: "Manager",
      organizationId: "org-1",
      permissions: [
        { action: "read", module: "members" },
        { action: "delete", module: "billing" },
      ],
    });

    expect(transaction.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          permissions: {
            createMany: { data: [{ action: "read", module: "members" }] },
          },
        }),
      })
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "role.created",
        actorId: "owner-1",
      }),
    });
  });

  it("updates a member role only when role and membership share the organization", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      membership: {
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "member-1",
          role: { isSystem: true, name: "Member" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      role: {
        findFirst: vi.fn().mockResolvedValue({
          id: "role-2",
          isSystem: false,
          name: "Manager",
        }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await updateMemberRole({
      actorId: "owner-1",
      membershipId: "member-1",
      organizationId: "org-1",
      roleId: "role-2",
    });

    expect(transaction.role.findFirst).toHaveBeenCalledWith({
      select: { id: true, isSystem: true, name: true },
      where: { id: "role-2", organizationId: "org-1" },
    });
    expect(transaction.membership.findFirst).toHaveBeenCalledWith({
      select: { id: true, role: { select: { isSystem: true, name: true } } },
      where: { id: "member-1", organizationId: "org-1", status: "ACTIVE" },
    });
    expect(transaction.membership.count).not.toHaveBeenCalled();
    expect(transaction.membership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "member-1", organizationId: "org-1", status: "ACTIVE" },
      })
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "member.role_updated",
        targetId: "member-1",
      }),
    });
  });

  it("rejects demoting the only active owner", async () => {
    const transaction = {
      auditLog: { create: vi.fn() },
      membership: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue({
          id: "member-1",
          role: { isSystem: true, name: "Owner" },
        }),
        updateMany: vi.fn(),
      },
      role: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "role-2", isSystem: true, name: "Member" }),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "owner-1" }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await expect(
      updateMemberRole({
        actorId: "owner-1",
        membershipId: "member-1",
        organizationId: "org-1",
        roleId: "role-2",
      })
    ).rejects.toThrow("LAST_OWNER_REQUIRED");

    expect(transaction.membership.count).toHaveBeenCalledWith({
      where: {
        id: { not: "member-1" },
        organizationId: "org-1",
        role: { isSystem: true, name: "Owner" },
        status: "ACTIVE",
      },
    });
    expect(transaction.membership.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it("allows demoting an owner when another active owner remains", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      membership: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: "member-1",
          role: { isSystem: true, name: "Owner" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      role: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "role-2", isSystem: true, name: "Member" }),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "owner-1" }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await updateMemberRole({
      actorId: "owner-1",
      membershipId: "member-1",
      organizationId: "org-1",
      roleId: "role-2",
    });

    expect(transaction.membership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roleId: "role-2" } })
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "member.role_updated",
        targetId: "member-1",
      }),
    });
    expect(transaction.user.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        id: "owner-1",
        status: "ACTIVE",
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("requires an active owner or super admin to cross the Owner boundary", async () => {
    const transaction = {
      auditLog: { create: vi.fn() },
      membership: {
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "member-1",
          role: { isSystem: true, name: "Member" },
        }),
        updateMany: vi.fn(),
      },
      role: {
        findFirst: vi.fn().mockResolvedValue({
          id: "role-owner",
          isSystem: true,
          name: "Owner",
        }),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await expect(
      updateMemberRole({
        actorId: "admin-1",
        membershipId: "member-1",
        organizationId: "org-1",
        roleId: "role-owner",
      })
    ).rejects.toMatchObject({ code: "OWNER_ROLE_REQUIRES_OWNER" });

    expect(transaction.membership.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it("allows an active super admin to cross the Owner boundary", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      membership: {
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "member-1",
          role: { isSystem: true, name: "Member" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      role: {
        findFirst: vi.fn().mockResolvedValue({
          id: "role-owner",
          isSystem: true,
          name: "Owner",
        }),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "super-admin-1" }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await updateMemberRole({
      actorId: "super-admin-1",
      membershipId: "member-1",
      organizationId: "org-1",
      roleId: "role-owner",
    });

    expect(transaction.membership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roleId: "role-owner" } })
    );
  });

  it("retries wrapped Serializable conflicts and returns the committed result", async () => {
    const committed = { id: "membership-1" };
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce({
        meta: {
          driverAdapterError: {
            kind: "TransactionWriteConflict",
            originalCode: "40001",
          },
        },
      })
      .mockResolvedValueOnce(committed);

    await expect(
      updateMemberRole({
        actorId: "owner-1",
        membershipId: "member-1",
        organizationId: "org-1",
        roleId: "role-2",
      })
    ).resolves.toBe(committed);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("maps exhaustion after exactly three conflicts", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue({ code: "P2034" });

    await expect(
      updateMemberRole({
        actorId: "owner-1",
        membershipId: "member-1",
        organizationId: "org-1",
        roleId: "role-2",
      })
    ).rejects.toMatchObject({ code: "OWNER_UPDATE_CONFLICT" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      3,
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
  });

  it("preserves unknown transaction failures", async () => {
    const failure = new Error("database unavailable");
    vi.mocked(prisma.$transaction).mockRejectedValue(failure);

    await expect(
      updateMemberRole({
        actorId: "owner-1",
        membershipId: "member-1",
        organizationId: "org-1",
        roleId: "role-2",
      })
    ).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not treat a custom role named Owner as the protected system owner", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      membership: {
        count: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "member-1",
          role: { isSystem: false, name: "Owner" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      role: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "role-2", isSystem: true, name: "Member" }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await updateMemberRole({
      actorId: "owner-1",
      membershipId: "member-1",
      organizationId: "org-1",
      roleId: "role-2",
    });

    expect(transaction.membership.count).not.toHaveBeenCalled();
    expect(transaction.membership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roleId: "role-2" } })
    );
  });
});
