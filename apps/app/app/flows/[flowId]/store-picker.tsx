"use client";

import { cn, EnvTag } from "@repo/design-system";
import {
  RadioGroup,
  RadioGroupItem,
} from "@repo/design-system/components/ui/radio-group";
import type { Store } from "../../lib/queries";

/**
 * Stores as radio cards with their environment. A selected production store
 * is ringed in red, so the target of a write is never in doubt.
 */
export function StorePicker({
  label,
  onChange,
  storeId,
  stores,
}: {
  label: string;
  onChange: (storeId: string) => void;
  storeId: string;
  stores: Store[];
}) {
  return (
    <RadioGroup
      aria-label={label}
      className="flex flex-col gap-2"
      onValueChange={(value) => onChange(String(value))}
      value={storeId}
    >
      {stores.map((store) => {
        const selected = store.id === storeId;
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
            <RadioGroupItem
              className={
                selected && prod
                  ? "data-checked:border-(--danger-solid)"
                  : undefined
              }
              id={`store-${store.id}`}
              value={store.id}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[13px] leading-[1.3]">
                {store.name}
              </span>
              <span className="block truncate font-mono text-muted-foreground text-xs leading-[1.3]">
                {store.shopDomain}
              </span>
            </span>
            <EnvTag environment={store.environment} />
          </label>
        );
      })}
    </RadioGroup>
  );
}
