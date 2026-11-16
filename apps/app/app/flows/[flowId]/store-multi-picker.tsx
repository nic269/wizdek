"use client";

import { cn, EnvTag, IdentityChip } from "@repo/design-system";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import type { Store } from "../../lib/queries";

export function StoreMultiPicker({
  label,
  onChange,
  storeIds,
  disabled,
  stores,
}: {
  label: string;
  onChange: (storeIds: string[]) => void;
  storeIds: string[];
  disabled?: boolean;
  stores: Store[];
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex max-h-[260px] flex-col overflow-y-auto rounded-card bg-card shadow-card"
      disabled={disabled}
    >
      {stores.map((store) => {
        const selected = storeIds.includes(store.id);
        return (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5 border-border border-b px-3 py-[9px] text-left text-[13px] last:border-b-0",
              selected ? "bg-sunken" : "hover:bg-sunken"
            )}
            htmlFor={`store-${store.id}`}
            key={store.id}
          >
            <Checkbox
              checked={selected}
              id={`store-${store.id}`}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...storeIds, store.id]
                    : storeIds.filter((id) => id !== store.id)
                )
              }
            />
            <IdentityChip id={store.id} name={store.name} size={18} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-[550]">{store.name}</span>{" "}
              <span className="text-muted-foreground text-xs tabular-nums">
                {store.shopDomain}
              </span>
            </span>
            <EnvTag compact environment={store.environment} />
          </label>
        );
      })}
    </fieldset>
  );
}
