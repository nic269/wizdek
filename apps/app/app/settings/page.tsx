import { EmptyState, PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../app-shell-layout";

export default function SettingsPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Project-specific settings belong in app feature folders or templates."
          title="Settings"
        />
        <EmptyState
          description="Add concrete settings as future product stories require them."
          title="No settings yet"
        />
      </div>
    </AppShellLayout>
  );
}
