import { PageHeader } from "@repo/design-system";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShellLayout } from "../../app-shell-layout";
import { BackLink } from "../../lib/back-link";
import { ConnectStoreGate } from "./connect-store-gate";

export const metadata: Metadata = { title: "Connect a store" };

export default function ConnectStorePage() {
  return (
    <AppShellLayout width="narrow">
      <PageHeader
        back={<BackLink href="/stores">Stores</BackLink>}
        description="Choose how wizdek gets access. You can switch methods later by reconnecting."
        title="Connect a store"
      />
      <Suspense>
        <ConnectStoreGate />
      </Suspense>
    </AppShellLayout>
  );
}
