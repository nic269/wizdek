import { authFeatureConfig } from "./features";

export interface DashboardNavItem {
  children?: readonly DashboardNavItem[];
  href: string;
  label: string;
}

export interface DashboardNavGroup {
  items: readonly DashboardNavItem[];
  label: string;
}

/**
 * The sidebar: Dashboard on its own, then one group per area. Every tool is
 * one click away; groups of several items open a flyout on the collapsed rail.
 */
export const createDashboardNavGroups = (
  organizationInvitations: boolean
): readonly DashboardNavGroup[] => [
  { items: [{ href: "/dashboard", label: "Dashboard" }], label: "" },
  {
    items: [
      { href: "/stores", label: "Stores" },
      { href: "/shopify/metafields", label: "Metafields" },
      { href: "/graphql", label: "GraphQL console" },
    ],
    label: "Shopify",
  },
  {
    items: [
      { href: "/flows", label: "Flows" },
      { href: "/functions", label: "Functions" },
    ],
    label: "Automation",
  },
  { items: [{ href: "/database", label: "Database" }], label: "Data" },
  // OMS_NAV_START
  {
    items: [{ href: "/works/oms-management", label: "OMS management" }],
    label: "Works",
  },
  // OMS_NAV_END
  {
    items: [
      { href: "/settings", label: "Settings" },
      ...(organizationInvitations
        ? [{ href: "/settings/members", label: "Members" }]
        : []),
      { href: "/settings/access", label: "Access" },
    ],
    label: "Organization",
  },
];

export const createDashboardNav = (organizationInvitations: boolean) =>
  createDashboardNavGroups(organizationInvitations).flatMap(
    ({ items }) => items
  );

export const dashboardNavGroups = createDashboardNavGroups(
  authFeatureConfig.organizationInvitations
);

export const dashboardNav = createDashboardNav(
  authFeatureConfig.organizationInvitations
);
