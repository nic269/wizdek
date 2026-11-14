import { Database, PageHeader } from "@repo/design-system";
import Link from "next/link";
import { AppShellLayout } from "../app-shell-layout";

export const metadata = { title: "Works" };
export default function WorksPage() {
  return (
    <AppShellLayout requiresOrganization={false} signInCallback="/works">
      <PageHeader
        description="Management tools for your connected systems."
        title="Works"
      />
      <Link
        className="flex max-w-xl items-start gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:bg-sunken"
        href="/works/oms-management"
      >
        <Database className="size-6 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="font-semibold text-lg">OMS management</h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Debug logs, site configuration and operations for staging and
            production.
          </p>
        </div>
      </Link>
    </AppShellLayout>
  );
}
