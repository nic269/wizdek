import { authFeatureConfig } from "@repo/config";
import { PageHeader } from "@repo/design-system";
import { notFound } from "next/navigation";
import { AppShellLayout } from "../../app-shell-layout";
import { MembersPanel } from "./members-panel";

export default async function MembersPage() {
  if (!authFeatureConfig.organizationInvitations) {
    notFound();
  }

  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Invite collaborators and manage pending access."
          title="Members"
        />
        <MembersPanel />
      </div>
    </AppShellLayout>
  );
}
