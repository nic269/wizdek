import { authFeatureConfig } from "./features";

export const createDashboardNav = (organizationInvitations: boolean) =>
  [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/settings", label: "Settings" },
    ...(organizationInvitations
      ? [{ href: "/settings/members", label: "Members" }]
      : []),
    { href: "/settings/access", label: "Access" },
  ] as const;

export const dashboardNav = createDashboardNav(
  authFeatureConfig.organizationInvitations
);
