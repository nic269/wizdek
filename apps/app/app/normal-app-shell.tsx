"use client";

import {
  AppShell,
  type AppShellLinkProps,
  type AppShellProps,
} from "@repo/design-system";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";

let cachedCollapsed = false;
const NormalAppShellLink = (props: AppShellLinkProps) => <Link {...props} />;

export function NormalAppShell({
  children,
  ...props
}: Omit<
  AppShellProps,
  "collapsed" | "currentPath" | "linkComponent" | "onCollapsedChange"
>) {
  const [collapsed, setCollapsed] = useState(cachedCollapsed);

  const handleCollapsedChange = useCallback((nextCollapsed: boolean) => {
    cachedCollapsed = nextCollapsed;
    setCollapsed(nextCollapsed);
  }, []);

  return (
    <AppShell
      {...props}
      collapsed={collapsed}
      currentPath={usePathname()}
      linkComponent={NormalAppShellLink}
      onCollapsedChange={handleCollapsedChange}
    >
      {children}
    </AppShell>
  );
}
