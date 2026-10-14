import { getCurrentSession } from "@repo/auth/session";
import { appConfig, dashboardNav } from "@repo/config";
import {
  AppShell,
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
import { SignOutButton } from "./dashboard/sign-out-button";
import { OrganizationSwitcher } from "./lib/active-organization";

const getDashboardNavIcon = (href: string) => {
  if (href.startsWith("/flows")) {
    return <Workflow className="h-4 w-4" />;
  }

  if (href.startsWith("/database")) {
    return <Database className="h-4 w-4" />;
  }

  if (href.startsWith("/graphql")) {
    return <Braces className="h-4 w-4" />;
  }

  if (href.startsWith("/stores")) {
    return <Store className="h-4 w-4" />;
  }

  if (href.includes("access")) {
    return <Shield className="h-4 w-4" />;
  }

  if (href.includes("members")) {
    return <Users className="h-4 w-4" />;
  }

  if (href.includes("settings")) {
    return <Settings className="h-4 w-4" />;
  }

  if (href.includes("dashboard")) {
    return <LayoutDashboard className="h-4 w-4" />;
  }

  return <Home className="h-4 w-4" />;
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
    <AppShell
      brand={appConfig.name}
      navItems={dashboardNav.map((item) => ({
        ...item,
        icon: getDashboardNavIcon(item.href),
      }))}
      topbar={
        <div className="flex w-full items-center justify-between gap-3">
          <OrganizationSwitcher />
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="font-medium text-foreground">
                {session.user.name}
              </div>
              <div className="text-muted-foreground">{session.user.email}</div>
            </div>
            <SignOutButton />
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
