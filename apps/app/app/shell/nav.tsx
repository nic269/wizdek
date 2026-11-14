import { dashboardNavGroups } from "@repo/config";
import {
  Boxes,
  Braces,
  Database,
  LayoutGrid,
  Settings,
  Shield,
  Store,
  Users,
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
  items: ShellNavItem[];
  label: string;
}

const ICONS: Record<string, ReactNode> = {
  "/dashboard": <LayoutGrid />,
  "/database": <Database />,
  "/flows": <Workflow />,
  "/graphql": <Braces />,
  "/settings": <Settings />,
  "/settings/access": <Shield />,
  "/settings/members": <Users />,
  "/shopify": <Boxes />,
  "/stores": <Store />,
  "/works": <Boxes />,
  "/works/oms-management": <Database />,
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
    items: group.items.map(withIcons),
    label: group.label,
  })
);
