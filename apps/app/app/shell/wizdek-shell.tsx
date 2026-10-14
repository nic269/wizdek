"use client";

import { appConfig } from "@repo/config";
import {
  AppShell,
  type AppShellIndicator,
  type AppShellLinkProps,
  type AppShellNavGroup,
} from "@repo/design-system";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useActiveOrganization } from "../lib/active-organization";
import { usePermissions } from "../lib/permissions";
import { isRunActive, useOrganizationRuns, useStores } from "../lib/queries";
import { AccountMenu } from "./account-menu";
import { CommandPalette } from "./command-palette";
import { shellNavGroups } from "./nav";
import { NoOrganization } from "./no-organization";
import { OrganizationSwitcher } from "./organization-switcher";

const COLLAPSED_KEY = "wizdek.sidebar-collapsed";

const ShellLink = ({
  children,
  className,
  href,
  onClick,
  title,
  "aria-current": ariaCurrent,
}: AppShellLinkProps) => (
  <Link
    aria-current={ariaCurrent}
    className={className}
    href={href}
    title={title}
    {...(onClick ? { onClick } : {})}
  >
    {children}
  </Link>
);

const readCollapsed = () => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

/** Stores needing a reconnect, and runs in progress, as sidebar indicators. */
const useIndicators = () => {
  const { organization } = useActiveOrganization();
  const { can } = usePermissions();
  const organizationId = organization?.id ?? null;
  const stores = useStores(organizationId, can("stores:read"));
  const runs = useOrganizationRuns(organizationId, can("flows:read"));
  const attention =
    stores.data?.filter(({ status }) => status === "RECONNECT_REQUIRED")
      .length ?? 0;
  const running =
    runs.data?.filter(({ status }) => isRunActive(status)).length ?? 0;
  return { attention, running };
};

const indicatorFor = (
  href: string,
  attention: number,
  running: number
): AppShellIndicator | null => {
  if (href === "/stores" && attention > 0) {
    return { label: String(attention), tone: "warning" };
  }
  if (href === "/flows" && running > 0) {
    return { label: `${running} running`, pulse: true, tone: "info" };
  }
  return null;
};

export function WizdekShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { email: string; name: string };
}) {
  const { isLoading, organizations } = useActiveOrganization();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { attention, running } = useIndicators();

  useEffect(() => setCollapsed(readCollapsed()), []);

  const handleCollapsedChange = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Without storage the choice lasts for this page only.
    }
  }, []);

  const navGroups = useMemo<AppShellNavGroup[]>(
    () =>
      shellNavGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          indicator: indicatorFor(item.href, attention, running),
        })),
      })),
    [attention, running]
  );

  // Without an organization no page has anything to show yet.
  const noOrganization = !isLoading && organizations.length === 0;
  const content = noOrganization ? <NoOrganization /> : children;

  return (
    <>
      <AppShell
        account={<AccountMenu email={user.email} name={user.name} />}
        brand={{
          meta: `${appConfig.shortName} · ${appConfig.versionLabel}`,
          name: appConfig.name,
        }}
        collapsed={collapsed}
        currentPath={usePathname()}
        linkComponent={ShellLink}
        navGroups={navGroups}
        onCollapsedChange={handleCollapsedChange}
        onSearch={() => setSearchOpen(true)}
        organization={<OrganizationSwitcher />}
      >
        {content}
      </AppShell>
      <CommandPalette
        navGroups={shellNavGroups}
        onOpenChange={setSearchOpen}
        open={searchOpen}
      />
    </>
  );
}
