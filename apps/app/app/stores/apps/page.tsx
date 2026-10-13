import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../app-shell-layout";
import { ShopifyAppsPanel } from "./shopify-apps-panel";

export default function ShopifyAppsPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Apps from the Shopify Dev Dashboard that this organization connects stores through."
          title="Shopify apps"
        />
        <ShopifyAppsPanel />
      </div>
    </AppShellLayout>
  );
}
