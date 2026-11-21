"use client";

import type { ConfigFormProps } from "../../../lib/form-parts";
import {
  isObjectSchema,
  JsonField,
  SchemaForm,
} from "../../../lib/schema-form";

/**
 * Builds a form from a node type's JSON Schema, so a new node type is
 * configurable without writing a form for it.
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
        value={config ?? null}
      />
    );
  }
  if (Object.keys(schema.properties ?? {}).length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        This step has nothing to configure.
      </p>
    );
  }
  return (
    <SchemaForm
      disabled={disabled}
      onChange={onChange}
      schema={{ properties: schema.properties ?? {} }}
      values={config}
    />
  );
}
