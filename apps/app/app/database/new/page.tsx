import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../app-shell-layout";
import { ConnectionForm } from "./connection-form";

export default function NewDatabaseConnectionPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Paste the database's connection URL. It is checked, then stored encrypted and never shown again."
          title="Add a database connection"
        />
        <ConnectionForm />
      </div>
    </AppShellLayout>
  );
}
