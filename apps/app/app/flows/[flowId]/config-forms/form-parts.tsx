"use client";

import { Checkbox as ShadcnCheckbox } from "@repo/design-system/components/ui/checkbox";
import {
  FieldDescription,
  FieldTitle,
  Field as ShadcnField,
} from "@repo/design-system/components/ui/field";
import { Label } from "@repo/design-system/components/ui/label";
import type { ReactNode } from "react";

export interface ConfigFormProps {
  config: Record<string, unknown>;
  disabled: boolean;
  onChange: (config: Record<string, unknown>) => void;
  /** Field names seen at this node in the latest run, if any. */
  sampleFields: readonly string[];
}

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
    <ShadcnField className="gap-1.5">
      <FieldTitle>{label}</FieldTitle>
      {children}
      {hint ? (
        <FieldDescription className="text-xs">{hint}</FieldDescription>
      ) : null}
    </ShadcnField>
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
    <Label className="font-normal">
      <ShadcnCheckbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      {label}
    </Label>
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
