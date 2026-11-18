"use client";

import { Button, Input } from "@repo/design-system";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useState } from "react";
import {
  asArray,
  asString,
  Checkbox,
  Field,
  removeAt,
  replaceAt,
} from "./form-parts";
import { OptionSelect } from "./option-select";

export interface SchemaProperty {
  default?: unknown;
  description?: string | undefined;
  enum?: readonly unknown[] | undefined;
  items?: { type?: string | undefined } | undefined;
  type?: string | undefined;
}

export interface ObjectSchema {
  properties?: Record<string, SchemaProperty> | undefined;
  required?: readonly string[] | undefined;
  /** Field names in the order to show them; other fields follow. */
  "x-order"?: readonly string[] | undefined;
}

export const isObjectSchema = (schema: unknown): schema is ObjectSchema =>
  typeof schema === "object" && schema !== null && "properties" in schema;

/** The choices of an enum property, when every choice is text. */
const stringChoices = (property: SchemaProperty): string[] | null =>
  Array.isArray(property.enum) &&
  property.enum.every((value) => typeof value === "string")
    ? (property.enum as string[])
    : null;

/** Edits a value no other control fits, as JSON text. */
export function JsonField({
  disabled,
  label,
  onChange,
  rows = 6,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: unknown) => void;
  rows?: number;
  value: unknown;
}) {
  const [text, setText] = useState(() =>
    value === undefined ? "" : JSON.stringify(value, null, 2)
  );
  const [isInvalid, setIsInvalid] = useState(false);

  return (
    <div className="space-y-1">
      <Textarea
        aria-label={label}
        className="font-mono text-xs"
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          if (event.target.value.trim() === "") {
            onChange(undefined);
            setIsInvalid(false);
            return;
          }
          try {
            onChange(JSON.parse(event.target.value));
            setIsInvalid(false);
          } catch {
            setIsInvalid(true);
          }
        }}
        rows={rows}
        value={text}
      />
      {isInvalid ? (
        <p className="text-destructive text-xs">
          Not valid JSON yet; the last valid value is kept.
        </p>
      ) : null}
    </div>
  );
}

const parseNumber = (text: string, integer: boolean): number | undefined => {
  if (text.trim() === "") {
    return;
  }
  const number = Number(text);
  return integer && Number.isFinite(number) ? Math.trunc(number) : number;
};

function PropertyControl({
  disabled,
  label,
  onChange,
  property,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: unknown) => void;
  property: SchemaProperty;
  value: unknown;
}) {
  const choices = stringChoices(property);
  if (choices) {
    return (
      <OptionSelect
        aria-label={label}
        disabled={disabled}
        onValueChange={onChange}
        options={choices.map((choice) => ({ label: choice, value: choice }))}
        value={asString(value, asString(property.default)) || null}
      />
    );
  }
  if (property.type === "boolean") {
    return (
      <Checkbox
        checked={value === true}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
    );
  }
  if (property.type === "number" || property.type === "integer") {
    const integer = property.type === "integer";
    return (
      <Input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(parseNumber(event.target.value, integer))}
        step={integer ? 1 : "any"}
        type="number"
        value={typeof value === "number" ? value : ""}
      />
    );
  }
  if (property.type === "string") {
    return (
      <Input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={asString(value)}
      />
    );
  }
  if (property.type === "array" && property.items?.type === "string") {
    const entries = asArray<string>(value);
    return (
      <div className="space-y-2">
        {entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
          <div className="flex gap-2" key={index}>
            <Input
              aria-label={`${label} ${index + 1}`}
              disabled={disabled}
              onChange={(event) =>
                onChange(replaceAt(entries, index, event.target.value))
              }
              value={entry}
            />
            <Button
              disabled={disabled}
              onClick={() => onChange(removeAt(entries, index))}
              size="sm"
              type="button"
              variant="ghost"
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled}
          onClick={() => onChange([...entries, ""])}
          size="sm"
          type="button"
          variant="outline"
        >
          Add
        </Button>
      </div>
    );
  }
  return (
    <JsonField
      disabled={disabled}
      label={label}
      onChange={onChange}
      value={value}
    />
  );
}

/** Property names in `x-order` first, then any others in schema order. */
export const orderedProperties = (
  schema: ObjectSchema
): [string, SchemaProperty][] => {
  const properties = schema.properties ?? {};
  const order = schema["x-order"] ?? [];
  const names = [
    ...order.filter((name) => name in properties),
    ...Object.keys(properties).filter((name) => !order.includes(name)),
  ];
  return names.map((name) => [name, properties[name] ?? {}]);
};

/**
 * Fields for an object's JSON Schema. Text, number, whole number, yes/no,
 * choice and text-list properties get a control; anything else is edited as
 * JSON.
 */
export function SchemaForm({
  disabled,
  onChange,
  schema,
  values,
}: {
  disabled: boolean;
  onChange: (values: Record<string, unknown>) => void;
  schema: ObjectSchema;
  values: Record<string, unknown>;
}) {
  const required = new Set(schema.required ?? []);
  return (
    <div className="space-y-4">
      {orderedProperties(schema).map(([key, property]) => (
        <Field
          key={key}
          label={required.has(key) ? `${key} *` : key}
          {...(property.description ? { hint: property.description } : {})}
        >
          <PropertyControl
            disabled={disabled}
            label={key}
            onChange={(value) => onChange({ ...values, [key]: value })}
            property={property}
            value={values[key]}
          />
        </Field>
      ))}
    </div>
  );
}
