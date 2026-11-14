"use client";

import { cn, EnvTag } from "@repo/design-system";
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
      className="flex flex-col gap-2"
      disabled={disabled}
    >
      {stores.map((store) => {
        const selected = storeIds.includes(store.id);
        const prod = store.environment === "PROD";
        return (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-menu border bg-card px-3 py-2.5 text-left transition-shadow",
              selected && prod && "border-[#d98f87] shadow-[0_0_0_3px_#fbeceb]",
              selected &&
                !prod &&
                "border-accent shadow-[0_0_0_3px_var(--accent-soft)]",
              !selected && "border-border hover:border-input"
            )}
            htmlFor={`store-${store.id}`}
            key={store.id}
          >
            <Checkbox
              checked={selected}
              className={
                selected && prod
                  ? "data-checked:border-(--danger-solid)"
                  : undefined
              }
              id={`store-${store.id}`}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...storeIds, store.id]
                    : storeIds.filter((id) => id !== store.id)
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[13px] leading-[1.3]">
                {store.name}
              </span>
              <span className="block truncate text-muted-foreground text-xs tabular-nums leading-[1.3]">
                {store.shopDomain}
              </span>
            </span>
            <EnvTag environment={store.environment} />
          </label>
        );
      })}
    </fieldset>
  );
}
