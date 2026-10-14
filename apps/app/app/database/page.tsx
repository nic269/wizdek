import { buttonVariants, PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../app-shell-layout";
import { ConnectionsPanel } from "./connections-panel";

export default function DatabasePage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          actions={
            <a className={buttonVariants()} href="/database/new">
              Add connection
            </a>
          }
          description="Databases this organization can back up. Open a connection to use its tools."
          title="Database"
        />
        <ConnectionsPanel />
      </div>
    </AppShellLayout>
  );
}
