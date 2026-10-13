import { ROLE_PERMISSION_PRESETS } from "@repo/access-control";
import { describe, expect, it, vi } from "vitest";
import { seedDatabase } from "./seed";

vi.mock("./client", () => ({ prisma: {} }));

describe("database seed", () => {
  it("reconciles system roles and permissions with the policy catalog", async () => {
    const transaction = {
      organization: {
        findMany: vi.fn().mockResolvedValue([{ id: "org-1" }, { id: "org-2" }]),
        upsert: vi.fn().mockResolvedValue({ id: "org-1" }),
      },
      role: {
        upsert: vi.fn().mockImplementation(({ create }) => ({
          id: `role-${create.name}`,
        })),
      },
      rolePermission: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const client = {
      $transaction: vi
        .fn()
        .mockImplementation((callback) => callback(transaction)),
    };

    await seedDatabase(client as never);

    expect(transaction.role.upsert).toHaveBeenCalledTimes(8);
    expect(transaction.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isSystem: true, name: "Owner" }),
        update: expect.objectContaining({ isSystem: true }),
      })
    );
    expect(transaction.rolePermission.deleteMany).toHaveBeenCalledTimes(8);
    expect(transaction.rolePermission.createMany).toHaveBeenCalledWith({
      data: ROLE_PERMISSION_PRESETS.Member.map((permission) => ({
        ...permission,
        roleId: "role-Member",
      })),
    });
  });
});
