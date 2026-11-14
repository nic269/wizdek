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

/** The sidebar: the work itself under Workspace, administration under Organization. */
export const createDashboardNavGroups = (
  organizationInvitations: boolean
): readonly DashboardNavGroup[] => [
  {
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/stores", label: "Stores" },
      { href: "/shopify", label: "Shopify" },
      { href: "/graphql", label: "GraphQL" },
      { href: "/flows", label: "Flows" },
      { href: "/database", label: "Database" },
      // OMS_NAV_START
      {
        children: [{ href: "/works/oms-management", label: "OMS management" }],
        href: "/works",
        label: "Works",
      },
      // OMS_NAV_END
    ],
    label: "Workspace",
  },
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
