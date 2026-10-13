import { prisma, syncSystemRoles } from "@repo/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  hashInvitationToken,
  listInvitations,
  revokeInvitation,
} from "./invitations";

vi.mock("@repo/database", () => ({
  prisma: {
    $transaction: vi.fn(),
    invitation: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  syncSystemRoles: vi.fn(),
}));

describe("invitation service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hashes invitation credentials before persistence", () => {
    expect(hashInvitationToken("secret-token")).toHaveLength(64);
    expect(hashInvitationToken("secret-token")).not.toContain("secret-token");
  });

  it("bounds invitation history with deterministic pagination", async () => {
    vi.mocked(prisma.invitation.findMany).mockResolvedValue([]);
    vi.mocked(prisma.invitation.updateMany).mockResolvedValue({ count: 0 });

    await listInvitations({ limit: 20, organizationId: "org-1" });

    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
        where: { organizationId: "org-1" },
      })
    );
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
      data: { status: "EXPIRED" },
      where: {
        expiresAt: { lte: expect.any(Date) },
        organizationId: "org-1",
        status: "PENDING",
      },
    });
  });

  it("creates a Member invitation and audit record transactionally", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      invitation: {
        create: vi
          .fn()
          .mockImplementation(({ data }) => ({ id: "invite-1", ...data })),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ name: "Acme" }),
      },
      role: {
        findUnique: vi.fn().mockResolvedValue({ id: "role-1" }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    const result = await createInvitation({
      email: " USER@example.com ",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      invitedById: "owner-1",
      organizationId: "org-1",
    });

    expect(result.token).toHaveLength(43);
    expect(result.organizationName).toBe("Acme");
    expect(transaction.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "user@example.com",
        organizationId: "org-1",
        roleId: "role-1",
        tokenHash: hashInvitationToken(result.token),
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "invitation.created",
        targetId: "invite-1",
      }),
    });
  });

  it("repairs system roles for a legacy organization before inviting", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      invitation: {
        create: vi
          .fn()
          .mockImplementation(({ data }) => ({ id: "invite-1", ...data })),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ name: "Legacy" }),
      },
      role: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    vi.mocked(syncSystemRoles).mockResolvedValue({
      Member: { id: "role-member", name: "Member" },
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    const result = await createInvitation({
      email: "member@example.com",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      invitedById: "owner-1",
      organizationId: "legacy-org",
    });

    expect(syncSystemRoles).toHaveBeenCalledWith(transaction, "legacy-org");
    expect(result.invitation.roleId).toBe("role-member");
  });

  it("retries after a concurrent pending invitation wins the unique race", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      invitation: {
        create: vi.fn().mockRejectedValueOnce({ code: "P2002" }),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "invite-1" }),
        update: vi.fn().mockImplementation(({ data }) => ({
          email: "user@example.com",
          id: "invite-1",
          status: "PENDING",
          ...data,
        })),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ name: "Acme" }),
      },
      role: {
        findUnique: vi.fn().mockResolvedValue({ id: "role-1" }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    const result = await createInvitation({
      email: "user@example.com",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      invitedById: "owner-1",
      organizationId: "org-1",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.invitation.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: hashInvitationToken(result.token),
      }),
      where: { id: "invite-1" },
    });
  });

  it("rejects acceptance from a different signed-in email", async () => {
    const transaction = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({
          email: "invited@example.com",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          id: "invite-1",
          organization: { name: "Acme", slug: "acme" },
          organizationId: "org-1",
          roleId: "role-1",
          status: "PENDING",
        }),
        updateMany: vi.fn(),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await expect(
      acceptInvitation({
        now: new Date("2029-01-01T00:00:00.000Z"),
        token: "token",
        userEmail: "other@example.com",
        userId: "user-1",
      })
    ).rejects.toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
  });

  it("commits an expired transition before returning the domain error", async () => {
    const transaction = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({
          email: "invited@example.com",
          expiresAt: new Date("2028-01-01T00:00:00.000Z"),
          id: "invite-1",
          organization: { name: "Acme", slug: "acme" },
          organizationId: "org-1",
          roleId: "role-1",
          status: "PENDING",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await expect(
      acceptInvitation({
        now: new Date("2029-01-01T00:00:00.000Z"),
        token: "token",
        userEmail: "invited@example.com",
        userId: "user-1",
      })
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });

    expect(transaction.invitation.updateMany).toHaveBeenCalledWith({
      data: { status: "EXPIRED" },
      where: {
        expiresAt: { lte: new Date("2029-01-01T00:00:00.000Z") },
        id: "invite-1",
        status: "PENDING",
      },
    });
  });

  it("activates membership and records acceptance", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      invitation: {
        findUnique: vi.fn().mockResolvedValue({
          email: "invited@example.com",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          id: "invite-1",
          organization: { name: "Acme", slug: "acme" },
          organizationId: "org-1",
          roleId: "role-1",
          status: "PENDING",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      membership: { upsert: vi.fn().mockResolvedValue({ id: "membership-1" }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await expect(
      acceptInvitation({
        now: new Date("2029-01-01T00:00:00.000Z"),
        token: "token",
        userEmail: "INVITED@example.com",
        userId: "user-1",
      })
    ).resolves.toEqual({ id: "org-1", name: "Acme", slug: "acme" });
    expect(transaction.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { roleId: "role-1", status: "ACTIVE" },
      })
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "invitation.accepted",
        actorId: "user-1",
      }),
    });
  });

  it("revokes only pending invitations and records audit evidence", async () => {
    const transaction = {
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      invitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback(transaction as never)
    );

    await revokeInvitation({
      actorId: "owner-1",
      invitationId: "invite-1",
      organizationId: "org-1",
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "invitation.revoked",
        actorId: "owner-1",
      }),
    });
  });
});
