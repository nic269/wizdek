"use client";
import { Button, Input } from "@repo/design-system";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import {
  asArray,
  asString,
  type ConfigFormProps,
  Field,
  removeAt,
  replaceAt,
} from "./form-parts";
import { GenericForm } from "./generic-form";

export function FetchCustomersForm({
  config,
  disabled,
  onChange,
}: ConfigFormProps) {
  return (
    <div className="space-y-4">
      <Field
        hint="GraphQL selection, including nested fields. Nested connections return only the number you request."
        label="Customer fields"
      >
        <Textarea
          aria-label="Customer fields"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, fields: event.target.value })
          }
          rows={7}
          value={asString(config.fields)}
        />
      </Field>
      <Field
        hint="Examples: created_at:>=2026-10-01 created_at:<2026-11-01 or updated_at:>=2026-10-20. Supports trigger templates. Empty fetches all customers."
        label="Customer search query"
      >
        <Textarea
          aria-label="Customer search query"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, query: event.target.value })
          }
          rows={3}
          value={asString(config.query)}
        />
      </Field>
      <GenericForm
        config={config}
        disabled={disabled}
        onChange={onChange}
        schema={{
          properties: {
            pageSize: {
              description:
                "Customers per page (1–250). Reduce for large nested selections.",
              type: "integer",
            },
            sortKey: {
              description: "Match the date field used in your search.",
              enum: ["ID", "CREATED_AT", "UPDATED_AT"],
              type: "string",
            },
          },
        }}
      />
    </div>
  );
}

export function ExportCsvForm({ config, disabled, onChange }: ConfigFormProps) {
  const columns = asArray<{ header: string; value: string }>(config.columns);
  const moveColumn = (from: number, to: number) => {
    const next = [...columns];
    const [column] = next.splice(from, 1);
    if (!column || to < 0 || to >= columns.length) {
      return;
    }
    next.splice(to, 0, column);
    onChange({ ...config, columns: next });
  };
  return (
    <div className="space-y-4">
      <GenericForm
        config={config}
        disabled={disabled}
        onChange={onChange}
        schema={{
          properties: {
            delimiter: { enum: [",", ";", "\t"], type: "string" },
            fileName: { type: "string" },
            rows: {
              description:
                "Use {{ $json.rows }} for Fetch customers; empty exports each input item.",
              type: "string",
            },
          },
        }}
      />
      <Field
        hint="Order below is the CSV column order. Values use fields of each customer, e.g. {{ $json.defaultEmailAddress.emailAddress }}."
        label="CSV columns"
      >
        <div className="space-y-3">
          {columns.map((column, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editable ordered configuration rows
            <div className="space-y-2 rounded border p-2" key={index}>
              <Input
                aria-label={`Column ${index + 1} header`}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...config,
                    columns: replaceAt(columns, index, {
                      ...column,
                      header: event.target.value,
                    }),
                  })
                }
                value={column.header}
              />
              <Input
                aria-label={`Column ${index + 1} value`}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...config,
                    columns: replaceAt(columns, index, {
                      ...column,
                      value: event.target.value,
                    }),
                  })
                }
                value={column.value}
              />
              <Button
                disabled={disabled}
                onClick={() =>
                  onChange({ ...config, columns: removeAt(columns, index) })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove column
              </Button>
              <Button
                aria-label={`Move column ${index + 1} up`}
                disabled={disabled || index === 0}
                onClick={() => moveColumn(index, index - 1)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Up
              </Button>
              <Button
                aria-label={`Move column ${index + 1} down`}
                disabled={disabled || index === columns.length - 1}
                onClick={() => moveColumn(index, index + 1)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Down
              </Button>
            </div>
          ))}
          <Button
            disabled={disabled}
            onClick={() =>
              onChange({
                ...config,
                columns: [...columns, { header: "", value: "" }],
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Add column
          </Button>
        </div>
      </Field>
    </div>
  );
}
