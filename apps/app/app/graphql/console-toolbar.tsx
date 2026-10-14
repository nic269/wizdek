"use client";

import type { apiClient } from "@repo/api/client";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Label } from "@repo/design-system/components/ui/label";
import { OptionSelect } from "../lib/option-select";
import type { Store } from "../stores/store-labels";

export type ApiVersion = Awaited<
  ReturnType<typeof apiClient.shopifyGraphql.versions>
>["data"]["versions"][number];

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
      <OptionSelect
        aria-label="Store"
        className="w-auto max-w-60"
        onValueChange={onStoreChange}
        options={stores.map((store) => ({
          label: `${store.name} (${store.shopDomain})`,
          value: store.id,
        }))}
        placeholder="Choose a store"
        value={storeId || null}
      />
      <OptionSelect
        aria-label="API version"
        className="w-auto"
        onValueChange={onApiVersionChange}
        options={versions.map((version) => ({
          label: version.displayName,
          value: version.handle,
        }))}
        value={apiVersion || null}
      />
      <Label className="font-normal">
        <Checkbox checked={costDebug} onCheckedChange={onCostDebugChange} />
        Return detailed cost
      </Label>
    </div>
  );
}
