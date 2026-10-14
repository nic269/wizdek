import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../../app-shell-layout";
import { BackLink } from "../../../lib/back-link";
import { OAuthCallback } from "./oauth-callback";

export default function ShopifyOAuthCallbackPage() {
  return (
    <AppShellLayout>
      <PageHeader
        back={<BackLink href="/stores">Stores</BackLink>}
        description="Finishing the Shopify install for this store."
        title="Connecting store"
      />
      <OAuthCallback />
    </AppShellLayout>
  );
}
