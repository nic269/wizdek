import { dashboardNavGroups } from "@repo/config";
import {
  Braces,
  Building2,
  Database,
  LayoutGrid,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Tag,
  Users,
  Warehouse,
  Workflow,
} from "@repo/design-system";
import type { ReactNode } from "react";

export interface ShellNavItem {
  children?: ShellNavItem[] | undefined;
  href: string;
  icon: ReactNode;
  label: string;
}

export interface ShellNavGroup {
  icon?: ReactNode | undefined;
  items: ShellNavItem[];
  label: string;
}

/** One icon per destination, so the collapsed rail scans without labels. */
const ICONS: Record<string, ReactNode> = {
  "/dashboard": <LayoutGrid />,
  "/database": <Database />,
  "/flows": <Workflow />,
  "/graphql": <Braces />,
  "/settings": <SlidersHorizontal />,
  "/settings/access": <ShieldCheck />,
  "/settings/members": <Users />,
  "/shopify/metafields": <Tag />,
  "/stores": <Store />,
  "/works/oms-management": <Warehouse />,
};

/** The rail icon of a group that opens a flyout. */
const GROUP_ICONS: Record<string, ReactNode> = {
  Organization: <Building2 />,
  Shopify: <ShoppingBag />,
};

const withIcons = (
  item: (typeof dashboardNavGroups)[number]["items"][number]
): ShellNavItem => ({
  ...item,
  children: item.children?.map(withIcons),
  icon: ICONS[item.href] ?? <LayoutGrid />,
});

export const shellNavGroups: ShellNavGroup[] = dashboardNavGroups.map(
  (group) => ({
    icon: GROUP_ICONS[group.label],
    items: group.items.map(withIcons),
    label: group.label,
  })
);
