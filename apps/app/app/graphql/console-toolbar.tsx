"use client";

import type { apiClient } from "@repo/api/client";
import type { Store } from "../stores/store-labels";

export type ApiVersion = Awaited<
  ReturnType<typeof apiClient.shopifyGraphql.versions>
>["data"]["versions"][number];

const selectClassName = "h-9 rounded-md border bg-background px-3 text-sm";

export function ConsoleToolbar({
  apiVersion,
  costDebug,
  onApiVersionChange,
  onCostDebugChange,
  onStoreChange,
  storeId,
  stores,
  versions,
}: {
  apiVersion: string;
  costDebug: boolean;
  onApiVersionChange: (apiVersion: string) => void;
  onCostDebugChange: (costDebug: boolean) => void;
  onStoreChange: (storeId: string) => void;
  storeId: string;
  stores: Store[];
  versions: ApiVersion[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        aria-label="Store"
        className={`${selectClassName} max-w-60`}
        onChange={(event) => onStoreChange(event.target.value)}
        value={storeId}
      >
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name} ({store.shopDomain})
          </option>
        ))}
      </select>
      <select
        aria-label="API version"
        className={selectClassName}
        onChange={(event) => onApiVersionChange(event.target.value)}
        value={apiVersion}
      >
        {versions.map((version) => (
          <option key={version.handle} value={version.handle}>
            {version.displayName}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input
          checked={costDebug}
          className="h-4 w-4"
          onChange={(event) => onCostDebugChange(event.target.checked)}
          type="checkbox"
        />
        Return detailed cost
      </label>
    </div>
  );
}
