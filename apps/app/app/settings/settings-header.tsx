"use client";

import { authFeatureConfig } from "@repo/config";
import { cn, Settings, Shield, Users } from "@repo/design-system";
import Link from "next/link";
import { useActiveOrganization } from "../lib/active-organization";

export type SettingsTab = "general" | "members" | "access";

const TABS = [
  { href: "/settings", icon: Settings, label: "General", tab: "general" },
  { href: "/settings/members", icon: Users, label: "Members", tab: "members" },
  { href: "/settings/access", icon: Shield, label: "Access", tab: "access" },
] as const;

const describe = (tab: SettingsTab, organizationName: string) => {
  if (tab === "members") {
    return {
      description: "Invite collaborators and manage pending invitations.",
      title: "Members",
    };
  }
  if (tab === "access") {
    return {
      description: `Roles, permissions, role assignments and the audit log for ${organizationName}.`,
      title: "Access",
    };
  }
  return {
    description: `Your profile and ${organizationName}’s organization details.`,
    title: "Settings",
  };
};

/** One header over General, Members and Access, with underline tabs. */
export function SettingsHeader({ tab }: { tab: SettingsTab }) {
  const { organization } = useActiveOrganization();
  const { description, title } = describe(
    tab,
    organization?.name ?? "your organization"
  );
  // Members lives behind the invitations feature, like its page.
  const tabs = TABS.filter(
    (item) =>
      item.tab !== "members" || authFeatureConfig.organizationInvitations
  );
  return (
    <header className="flex flex-col gap-3.5 border-border border-b">
      <div className="flex min-w-[min(100%,240px)] flex-col">
        <h1 className="m-0 font-semibold text-2xl leading-[1.15] tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1.5 text-muted-foreground text-sm leading-normal">
          {description}
        </p>
      </div>
      <nav
        aria-label="Settings"
        className="-mb-px flex gap-0.5 overflow-x-auto"
      >
        {tabs.map((item) => {
          const current = item.tab === tab;
          const Icon = item.icon;
          return (
            <Link
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-[7px] border-b-2 px-3 font-medium text-[13.5px] leading-none transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent-soft",
                current
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground"
              )}
              href={item.href}
              key={item.tab}
            >
              <Icon className="size-[15px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
