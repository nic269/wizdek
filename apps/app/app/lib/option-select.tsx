"use client";

import { cn } from "@repo/design-system";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";

export interface SelectOption<Value extends string = string> {
  disabled?: boolean;
  label: string;
  value: Value;
}

/**
 * A shadcn Select over a flat list of string options, for the many pickers
 * whose items are just a value and a label. The trigger carries the
 * accessible name, so pass `aria-label` or an `id` a label points at.
 */
export function OptionSelect<Value extends string>({
  "aria-label": ariaLabel,
  className,
  disabled,
  id,
  onValueChange,
  options,
  placeholder,
  value,
}: {
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: Value) => void;
  options: readonly SelectOption<Value>[];
  placeholder?: string;
  value: Value | null;
}) {
  return (
    <Select
      disabled={disabled}
      items={options}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange(next);
        }
      }}
      value={value}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn("w-full", className)}
        id={id}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
