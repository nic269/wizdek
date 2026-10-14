import { getCurrentSession } from "@repo/auth/session";
import { appConfig, dashboardNav } from "@repo/config";
import {
  Braces,
  Database,
  Home,
  LayoutDashboard,
  Settings,
  Shield,
  Store,
  Users,
  Workflow,
} from "@repo/design-system";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { OrganizationSwitcher } from "./lib/active-organization";
import { NormalAppShell } from "./normal-app-shell";

const getDashboardNavIcon = (href: string) => {
  if (href.startsWith("/flows")) {
    return <Workflow className="size-[17px]" />;
  }

  if (href.startsWith("/database")) {
    return <Database className="size-[17px]" />;
  }

  if (href.startsWith("/graphql")) {
    return <Braces className="size-[17px]" />;
  }

  if (href.startsWith("/stores")) {
    return <Store className="size-[17px]" />;
  }

  if (href.includes("access")) {
    return <Shield className="size-[17px]" />;
  }

  if (href.includes("members")) {
    return <Users className="size-[17px]" />;
  }

  if (href.includes("settings")) {
    return <Settings className="size-[17px]" />;
  }

  if (href.includes("dashboard")) {
    return <LayoutDashboard className="size-[17px]" />;
  }

  return <Home className="size-[17px]" />;
};

interface AppShellLayoutProps {
  children: ReactNode;
}

export async function AppShellLayout({ children }: AppShellLayoutProps) {
  const session = await getCurrentSession(await headers());

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <NormalAppShell
      brand={appConfig.name}
      navItems={dashboardNav.map((item) => ({
        ...item,
        icon: getDashboardNavIcon(item.href),
      }))}
      searchLabel={`Search ${appConfig.name}`}
      topbar={
        <div className="flex flex-col gap-2">
          <div className="in-data-[collapsed=true]:hidden">
            <OrganizationSwitcher />
          </div>
          <AccountMenu email={session.user.email} name={session.user.name} />
        </div>
      }
    >
      {/* One white panel on the canvas; on desktop only this panel scrolls. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 rounded-[12px] border border-[var(--shell-hairline,var(--border))] bg-card px-4 pt-5 pb-7 lg:overflow-auto lg:px-8 lg:pt-7 lg:pb-10 [&>*]:shrink-0">
        {children}
      </div>
    </NormalAppShell>
  );
}
