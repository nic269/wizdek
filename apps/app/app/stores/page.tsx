import { buttonVariants, PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../app-shell-layout";
import { StoresPanel } from "./stores-panel";

export default function StoresPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          actions={
            <>
              <a
                className={buttonVariants({ variant: "outline" })}
                href="/stores/apps"
              >
                Shopify apps
              </a>
              <a className={buttonVariants()} href="/stores/new">
                Connect store
              </a>
            </>
          }
          description="Shopify stores connected to the active organization."
          title="Stores"
        />
        <StoresPanel />
      </div>
    </AppShellLayout>
  );
}
