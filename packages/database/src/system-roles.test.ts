import { ROLE_PERMISSION_PRESETS } from "@repo/access-control";
import { describe, expect, it, vi } from "vitest";
import { syncSystemRoles } from "./system-roles";

describe("system role reconciliation", () => {
  it("upserts every system role and replaces persisted permissions", async () => {
    const transaction = {
      role: {
        upsert: vi.fn().mockImplementation(({ create }) => ({
          id: `role-${create.name}`,
          name: create.name,
        })),
      },
      rolePermission: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const roles = await syncSystemRoles(transaction as never, "org-1");

    expect(transaction.role.upsert).toHaveBeenCalledTimes(4);
    expect(roles.Owner).toEqual({ id: "role-Owner", name: "Owner" });
    expect(transaction.rolePermission.deleteMany).toHaveBeenCalledTimes(4);
    expect(transaction.rolePermission.createMany).toHaveBeenCalledWith({
      data: ROLE_PERMISSION_PRESETS.Member.map((permission) => ({
        ...permission,
        roleId: "role-Member",
      })),
    });
  });
});
