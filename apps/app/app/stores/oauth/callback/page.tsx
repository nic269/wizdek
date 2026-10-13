import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../../app-shell-layout";
import { OAuthCallback } from "./oauth-callback";

export default function ShopifyOAuthCallbackPage() {
  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Finishing the Shopify install for this store."
          title="Connecting store"
        />
        <OAuthCallback />
      </div>
    </AppShellLayout>
  );
}
