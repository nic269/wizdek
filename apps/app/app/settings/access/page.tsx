import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../app-shell-layout";
import { AccessPanel } from "./access-panel";

export default async function AccessPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Manage organization roles, member assignments, and audit history."
          title="Access"
        />
        <AccessPanel />
      </div>
    </AppShellLayout>
  );
}
