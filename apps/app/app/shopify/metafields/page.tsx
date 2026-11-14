import type { Metadata } from "next";
import { AppShellLayout } from "../../app-shell-layout";
import { MetafieldsPanel } from "./metafields-panel";

export const metadata: Metadata = { title: "Metafields · Shopify" };

export default function MetafieldsPage() {
  return (
    <AppShellLayout>
      <MetafieldsPanel />
    </AppShellLayout>
  );
}
