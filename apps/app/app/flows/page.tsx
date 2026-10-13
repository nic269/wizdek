import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../app-shell-layout";
import { FlowsPanel } from "./flows-panel";

export default function FlowsPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Automations that run against a connected store, one item at a time."
          title="Flows"
        />
        <FlowsPanel />
      </div>
    </AppShellLayout>
  );
}
