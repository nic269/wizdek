import { PageHeader } from "@repo/design-system";
import { AppShellLayout } from "../../app-shell-layout";
import { ConnectStoreForm } from "./connect-store-form";

export default async function ConnectStorePage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const { shop } = await searchParams;

  return (
    <AppShellLayout>
      <div className="space-y-6">
        <PageHeader
          description="Choose how this organization gets access to the store."
          title="Connect a store"
        />
        <ConnectStoreForm initialShopDomain={shop ?? ""} />
      </div>
    </AppShellLayout>
  );
}
