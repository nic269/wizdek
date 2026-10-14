"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export interface SegmentedOption<Value extends string> {
  /** A count shown in mono after the label. */
  count?: number | string | undefined;
  disabled?: boolean | undefined;
  icon?: ReactNode | undefined;
  label: ReactNode;
  value: Value;
}

/**
 * A single-choice segmented control: a sunken track with the chosen segment
 * raised in white. Built on the shadcn ToggleGroup.
 */
export const SegmentedControl = <Value extends string>({
  options,
  value,
  onValueChange,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: {
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string | undefined;
  /** `default` segments are 26px tall, `sm` 22px. */
  size?: "default" | "sm";
  "aria-label": string;
}) => (
  <ToggleGroup
    aria-label={ariaLabel}
    className={cn(
      "gap-0.5 rounded-[calc(var(--radius)+2px)] border border-border bg-sunken p-[3px]",
      className
    )}
    onValueChange={([picked]) => {
      if (picked !== undefined) {
        onValueChange(picked as Value);
      }
    }}
    spacing={0}
    value={[value]}
  >
    {options.map((option) => (
      <ToggleGroupItem
        className={cn(
          "h-[26px] min-w-0 gap-1.5 rounded-lg! px-2.5! font-medium text-[12.5px] text-muted-foreground hover:bg-transparent hover:text-foreground data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(0,0,0,.05)] [&_svg:not([class*='size-'])]:size-3.5",
          size === "sm" && "h-[22px] px-2! text-xs"
        )}
        disabled={option.disabled}
        key={option.value}
        value={option.value}
      >
        {option.icon}
        {option.label}
        {option.count === undefined ? null : (
          <span className="font-mono text-[11px] text-muted-foreground">
            {option.count}
          </span>
        )}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);
