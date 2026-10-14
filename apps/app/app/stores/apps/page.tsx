import type { Metadata } from "next";
import { AppShellLayout } from "../../app-shell-layout";
import { ShopifyAppsPanel } from "./shopify-apps-panel";

export const metadata: Metadata = { title: "Shopify apps" };

export default function ShopifyAppsPage() {
  return (
    <AppShellLayout>
      <ShopifyAppsPanel />
    </AppShellLayout>
  );
}
