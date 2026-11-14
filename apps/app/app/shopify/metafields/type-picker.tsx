"use client";

import { useMemo } from "react";
import { OptionSelect } from "../../lib/option-select";
import { baseType, changeBaseType, typeLabel } from "./metafield-types";

export function TypePicker({
  value,
  types,
  disabled,
  rowNumber,
  onChange,
}: {
  value: string;
  types: { name: string }[];
  disabled: boolean;
  rowNumber: number;
  onChange: (value: string) => void;
}) {
  const supported = useMemo(
    () => new Set(types.map((type) => type.name)),
    [types]
  );
  const options = useMemo(
    () =>
      [...new Set(types.map((type) => baseType(type.name)))]
        .map((type) => ({ label: typeLabel(type), value: type }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [types]
  );
  const base = baseType(value);
  return (
    <OptionSelect
      aria-label={`Row ${rowNumber} type`}
      disabled={disabled}
      onValueChange={(next) => onChange(changeBaseType(value, next, supported))}
      options={options}
      value={base}
    />
  );
}

export function ValueModePicker({
  value,
  types,
  disabled,
  rowNumber,
  onChange,
}: {
  value: string;
  types: { name: string }[];
  disabled: boolean;
  rowNumber: number;
  onChange: (value: string) => void;
}) {
  const base = baseType(value);
  return (
    <OptionSelect
      aria-label={`Row ${rowNumber} value mode`}
      disabled={disabled}
      onValueChange={(mode) =>
        onChange(mode === "list" ? `list.${base}` : base)
      }
      options={[
        {
          disabled: !types.some((type) => type.name === base),
          label: "One value",
          value: "one",
        },
        {
          disabled: !types.some((type) => type.name === `list.${base}`),
          label: "List of values",
          value: "list",
        },
      ]}
      value={value.startsWith("list.") ? "list" : "one"}
    />
  );
}
