import { ROLE_PERMISSION_PRESETS } from "@repo/access-control";
import { describe, expect, it, vi } from "vitest";
import { syncAllSystemRoles } from "./sync-all-system-roles";

describe("syncAllSystemRoles", () => {
  it("reconciles every organization in its own transaction", async () => {
    const transaction = {
      role: {
        upsert: vi.fn().mockImplementation(({ create }) => ({
          id: `role-${create.organizationId}-${create.name}`,
          name: create.name,
        })),
      },
      rolePermission: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const client = {
      $transaction: vi.fn((run: (tx: typeof transaction) => unknown) =>
        run(transaction)
      ),
      organization: {
        findMany: vi.fn().mockResolvedValue([{ id: "org-1" }, { id: "org-2" }]),
      },
    };

    await expect(syncAllSystemRoles(client as never)).resolves.toBe(2);

    const roleCount = Object.keys(ROLE_PERMISSION_PRESETS).length;
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.role.upsert).toHaveBeenCalledTimes(2 * roleCount);
    expect(transaction.rolePermission.createMany).toHaveBeenCalledWith({
      data: ROLE_PERMISSION_PRESETS.Member.map((permission) => ({
        ...permission,
        roleId: "role-org-2-Member",
      })),
    });
  });
});
