"use client";

import type { ReactNode } from "react";

export interface ConfigFormProps {
  config: Record<string, unknown>;
  disabled: boolean;
  onChange: (config: Record<string, unknown>) => void;
  /** Field names seen at this node in the latest run, if any. */
  sampleFields: readonly string[];
}

export const selectClassName =
  "h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60";

export function Field({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-sm">{label}</p>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        checked={checked}
        className="h-4 w-4"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

export const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const asArray = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

/** Returns a copy of the list with one entry replaced. */
export const replaceAt = <T,>(list: readonly T[], index: number, entry: T) =>
  list.map((current, position) => (position === index ? entry : current));

export const removeAt = <T,>(list: readonly T[], index: number) =>
  list.filter((_, position) => position !== index);
