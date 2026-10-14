"use client";

import { Lock, ReadOnlyBanner, Shimmer } from "@repo/design-system";
import { usePermissions } from "../../lib/permissions";
import { ConnectStoreForm } from "./connect-store-form";

/** Connecting needs `stores:manage`; anyone else is told why, not shown a form. */
export function ConnectStoreGate() {
  const { can, isLoading } = usePermissions();
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <span className="sr-only">Loading</span>
        <Shimmer className="h-24 w-full" />
      </div>
    );
  }
  if (!can("stores:manage")) {
    return (
      <ReadOnlyBanner>
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" />
          Connecting a store needs the <strong>Manage Shopify stores</strong>{" "}
          permission. Ask an Owner to connect it or to grant you access.
        </span>
      </ReadOnlyBanner>
    );
  }
  return <ConnectStoreForm />;
}
