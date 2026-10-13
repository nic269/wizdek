"use client";

import { Button, Input } from "@repo/design-system";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useState } from "react";
import {
  asArray,
  asString,
  Checkbox,
  type ConfigFormProps,
  Field,
  removeAt,
  replaceAt,
  selectClassName,
} from "./form-parts";

interface SchemaProperty {
  default?: unknown;
  description?: string;
  enum?: unknown[];
  items?: { type?: string };
  type?: string;
}

interface ObjectSchema {
  properties?: Record<string, SchemaProperty>;
}

const isObjectSchema = (schema: unknown): schema is ObjectSchema =>
  typeof schema === "object" && schema !== null && "properties" in schema;

/** The choices of an enum property, when every choice is text. */
const stringChoices = (property: SchemaProperty): string[] | null =>
  Array.isArray(property.enum) &&
  property.enum.every((value) => typeof value === "string")
    ? (property.enum as string[])
    : null;

/** Edits a value this form has no control for, as JSON text. */
function JsonField({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(value ?? null, null, 2)
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
          try {
            onChange(JSON.parse(event.target.value));
            setIsInvalid(false);
          } catch {
            setIsInvalid(true);
          }
        }}
        rows={6}
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
      <select
        aria-label={label}
        className={selectClassName}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={asString(value, asString(property.default))}
      >
        {choices.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
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
    return (
      <Input
        aria-label={label}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value)
          )
        }
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

/**
 * Builds a form from a node type's JSON Schema, so a new node type is
 * configurable without writing a form for it. Text, number, yes/no, choice
 * and text-list fields get a control; anything else is edited as JSON.
 */
export function GenericForm({
  config,
  disabled,
  onChange,
  schema,
}: ConfigFormProps & { schema: unknown }) {
  if (!isObjectSchema(schema)) {
    return (
      <JsonField
        disabled={disabled}
        label="Configuration"
        onChange={(value) =>
          onChange(
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : {}
          )
        }
        value={config}
      />
    );
  }
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        This step has nothing to configure.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {properties.map(([key, property]) => (
        <Field
          key={key}
          label={key}
          {...(property.description ? { hint: property.description } : {})}
        >
          <PropertyControl
            disabled={disabled}
            label={key}
            onChange={(value) => onChange({ ...config, [key]: value })}
            property={property}
            value={config[key]}
          />
        </Field>
      ))}
    </div>
  );
}
