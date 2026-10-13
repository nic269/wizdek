import { type KnownPermission, PERMISSION_CATALOG } from "@repo/access-control";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  createdInvitationSchema,
  invitationStatusSchema,
  memberSchema,
  membershipStatusSchema,
  permissionSchema,
} from "./organizations";

describe("organization API contracts", () => {
  it("accepts every exact permission catalog pair", () => {
    for (const { action, module } of PERMISSION_CATALOG) {
      expect(permissionSchema.parse({ action, module })).toEqual({
        action,
        module,
      });
    }
  });

  it.each([
    { action: "manage", module: "audit" },
    { action: "invite", module: "organization" },
    { action: "read", module: "unknown" },
  ])("rejects invalid permission cross-pair $module:$action", (permission) => {
    expect(permissionSchema.safeParse(permission).success).toBe(false);
  });

  it("exposes the correlated permission union to typed clients", () => {
    expectTypeOf<
      z.infer<typeof permissionSchema>
    >().toEqualTypeOf<KnownPermission>();
  });

  it("constrains invitation and membership statuses", () => {
    expect(invitationStatusSchema.options).toEqual([
      "PENDING",
      "ACCEPTED",
      "REVOKED",
      "EXPIRED",
    ]);
    expect(membershipStatusSchema.options).toEqual([
      "ACTIVE",
      "INVITED",
      "DISABLED",
    ]);
    expect(invitationStatusSchema.safeParse("UNKNOWN").success).toBe(false);
    expect(membershipStatusSchema.safeParse("UNKNOWN").success).toBe(false);
    expect(
      createdInvitationSchema.shape.status.safeParse("ACCEPTED").success
    ).toBe(false);
    expect(memberSchema.shape.status.safeParse("INVITED").success).toBe(false);
  });
});
