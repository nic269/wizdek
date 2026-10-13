import { prisma } from "@repo/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission, requirePermission } from "./permissions";

vi.mock("@repo/database", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

const permissionInput = {
  action: "read",
  module: "members",
  organizationId: "org-1",
  userId: "user-1",
};

describe("permission helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows active super admins without membership lookup", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperAdmin: true,
      status: "ACTIVE",
    } as never);

    await expect(hasPermission(permissionInput)).resolves.toBe(true);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it("denies suspended super admins", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperAdmin: true,
      status: "SUSPENDED",
    } as never);

    await expect(hasPermission(permissionInput)).resolves.toBe(false);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it("allows active members with matching role permissions", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperAdmin: false,
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({
      role: { permissions: [{ id: "permission-1" }] },
      status: "ACTIVE",
    } as never);

    await expect(hasPermission(permissionInput)).resolves.toBe(true);
  });

  it("denies suspended members before membership lookup", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperAdmin: false,
      status: "SUSPENDED",
    } as never);

    await expect(hasPermission(permissionInput)).resolves.toBe(false);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it("throws when required permission is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      isSuperAdmin: false,
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValue(null);

    await expect(requirePermission(permissionInput)).rejects.toThrow(
      "Missing permission members:read"
    );
  });
});
