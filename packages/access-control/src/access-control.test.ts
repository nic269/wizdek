import { describe, expect, it } from "vitest";
import {
  CUSTOM_ROLE_DEFAULT_PERMISSION_KEYS,
  isKnownPermission,
  normalizePermissions,
  OWNER_PERMISSIONS,
  PERMISSION_CATALOG,
  permissionKey,
  ROLE_PERMISSION_PRESETS,
} from ".";

describe("access-control policy", () => {
  it("derives owner access and keys from the catalog", () => {
    expect(OWNER_PERMISSIONS).toHaveLength(PERMISSION_CATALOG.length);
    expect(OWNER_PERMISSIONS.map(permissionKey)).toEqual(
      PERMISSION_CATALOG.map(permissionKey)
    );
  });

  it("rejects unknown permissions and de-duplicates known values", () => {
    expect(isKnownPermission({ action: "manage", module: "roles" })).toBe(true);
    expect(isKnownPermission({ action: "delete", module: "billing" })).toBe(
      false
    );
    expect(
      normalizePermissions([
        { action: "read", module: "members" },
        { action: "read", module: "members" },
        { action: "delete", module: "billing" },
      ])
    ).toEqual([{ action: "read", module: "members" }]);
  });

  it("keeps every role preset and UI default inside the catalog", () => {
    const knownKeys = new Set(PERMISSION_CATALOG.map(permissionKey));
    for (const permissions of Object.values(ROLE_PERMISSION_PRESETS)) {
      expect(
        permissions.every((permission) => isKnownPermission(permission))
      ).toBe(true);
    }
    expect(
      CUSTOM_ROLE_DEFAULT_PERMISSION_KEYS.every((key) => knownKeys.has(key))
    ).toBe(true);
  });

  it("lets members use stores and the console but not manage connections", () => {
    const keysOf = (role: keyof typeof ROLE_PERMISSION_PRESETS) =>
      ROLE_PERMISSION_PRESETS[role].map(permissionKey);

    expect(keysOf("Member")).toEqual(
      expect.arrayContaining(["stores:read", "graphql:query", "graphql:mutate"])
    );
    expect(keysOf("Member")).not.toContain("stores:manage");
    expect(keysOf("Admin")).toContain("stores:manage");
    expect(keysOf("Owner")).toContain("stores:manage");
    expect(keysOf("Viewer")).toContain("stores:read");
    expect(keysOf("Viewer")).not.toContain("graphql:query");
    expect(keysOf("Viewer")).not.toContain("graphql:mutate");
  });
});
