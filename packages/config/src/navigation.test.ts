import { describe, expect, it } from "vitest";
import { createDashboardNav, dashboardNav } from "./navigation";

describe("dashboard navigation", () => {
  it("includes the invitation-only members surface while enabled", () => {
    expect(dashboardNav).toContainEqual({
      href: "/settings/members",
      label: "Members",
    });
  });

  it("hides the invitation-only members surface while disabled", () => {
    expect(createDashboardNav(false)).not.toContainEqual({
      href: "/settings/members",
      label: "Members",
    });
  });
});
