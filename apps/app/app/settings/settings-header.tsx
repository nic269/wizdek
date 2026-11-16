"use client";

import { PageHeader, ShellHeader } from "@repo/design-system";
import { useActiveOrganization } from "../lib/active-organization";

export type SettingsTab = "general" | "members" | "access";

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

/** The breadcrumb and page title shared by Settings, Members and Access. */
export function SettingsHeader({ tab }: { tab: SettingsTab }) {
  const { organization } = useActiveOrganization();
  const { description, title } = describe(
    tab,
    organization?.name ?? "your organization"
  );
  return (
    <>
      <ShellHeader crumbs={[{ label: "Organization" }, { label: title }]} />
      <PageHeader description={description} title={title} />
    </>
  );
}
