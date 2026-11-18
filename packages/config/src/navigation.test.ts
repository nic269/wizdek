import { describe, expect, it } from "vitest";
import {
  createDashboardNav,
  dashboardNav,
  dashboardNavGroups,
} from "./navigation";

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

  it("links the store connections and console surfaces", () => {
    expect(dashboardNav).toContainEqual({ href: "/stores", label: "Stores" });
    expect(dashboardNav).toContainEqual({
      href: "/graphql",
      label: "GraphQL console",
    });
    expect(dashboardNav).toContainEqual({ href: "/flows", label: "Flows" });
    expect(dashboardNav).toContainEqual({
      href: "/functions",
      label: "Functions",
    });
    expect(dashboardNav).toContainEqual({
      href: "/database",
      label: "Database",
    });
  });
});

describe("dashboard navigation groups", () => {
  it("groups every tool by area, with Dashboard on its own", () => {
    expect(dashboardNavGroups.map(({ label }) => label)).toEqual([
      "",
      "Shopify",
      "Automation",
      "Data",
      "Works",
      "Organization",
    ]);
    expect(
      dashboardNavGroups.map(({ items }) => items.map(({ label }) => label))
    ).toEqual([
      ["Dashboard"],
      ["Stores", "Metafields", "GraphQL console"],
      ["Flows", "Functions"],
      ["Database"],
      ["OMS management"],
      ["Settings", "Members", "Access"],
    ]);
  });
});

// OMS_NAV_TEST_START
it("lists OMS management under Works", () => {
  const works = dashboardNavGroups.find(({ label }) => label === "Works");
  expect(works?.items).toEqual([
    { href: "/works/oms-management", label: "OMS management" },
  ]);
});
// OMS_NAV_TEST_END
