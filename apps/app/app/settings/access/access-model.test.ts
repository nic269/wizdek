import { PERMISSION_CATALOG, permissionKey } from "@repo/access-control";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_GROUPS,
  permissionsFromKeys,
  sortRoles,
} from "./access-model";

describe("access model", () => {
  it("places every catalog permission in exactly one grid group", () => {
    const gridKeys = PERMISSION_GROUPS.flatMap((group) =>
      group.items.map((item) => item.key)
    );
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect([...gridKeys].sort(byName)).toEqual(
      PERMISSION_CATALOG.map(permissionKey).sort(byName)
    );
  });

  it("turns permission keys back into catalog pairs", () => {
    expect(permissionsFromKeys(new Set(["flows:run", "members:read"]))).toEqual(
      [
        { action: "read", module: "members" },
        { action: "run", module: "flows" },
      ]
    );
  });

  it("lists built-in roles in rank order before custom roles", () => {
    const names = sortRoles([
      { name: "Viewer" },
      { name: "Support" },
      { name: "Owner" },
      { name: "Analyst" },
      { name: "Member" },
      { name: "Admin" },
    ]).map((role) => role.name);
    expect(names).toEqual([
      "Owner",
      "Admin",
      "Member",
      "Viewer",
      "Analyst",
      "Support",
    ]);
  });
});
