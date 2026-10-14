import { dashboardNavGroups } from "@repo/config";
import {
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
  "/stores": <Store />,
};

export const shellNavGroups: ShellNavGroup[] = dashboardNavGroups.map(
  (group) => ({
    items: group.items.map((item) => ({
      ...item,
      icon: ICONS[item.href] ?? <LayoutGrid />,
    })),
    label: group.label,
  })
);
