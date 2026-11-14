"use client";

import { Button } from "@repo/design-system";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Field, FieldLabel } from "@repo/design-system/components/ui/field";
import { useQuery } from "@tanstack/react-query";
import { OptionSelect } from "../../lib/option-select";
import { listMetaobjects } from "./metaobject-api";
import { isMixed } from "./metaobject-validation";

export function MetaobjectPicker({
  storeId,
  type,
  ids,
  onChange,
  disabled,
  rowId,
}: {
  storeId: string;
  type: string;
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  rowId: string;
}) {
  const query = useQuery({
    queryFn: () => listMetaobjects(storeId),
    queryKey: ["metaobject-definitions", storeId],
  });
  if (query.isPending) {
    return <p role="status">Loading metaobject definitions…</p>;
  }
  if (query.error) {
    return (
      <p role="alert">
        {query.error.message} This picker requires read_metaobject_definitions
        access.{" "}
        <Button onClick={() => query.refetch()} type="button" variant="outline">
          Retry
        </Button>
      </p>
    );
  }
  const options = (query.data ?? []).map((item) => ({
    label: `${item.name} (${item.type})`,
    value: item.id,
  }));
  if (!options.length) {
    return (
      <p>
        No metaobject definitions in this store. Create one in Shopify first.
      </p>
    );
  }
  if (!isMixed(type)) {
    return (
      <OptionSelect
        aria-label="Allowed metaobject definition"
        disabled={disabled}
        onValueChange={(id) => onChange([id])}
        options={options}
        placeholder="Choose a metaobject definition"
        value={ids[0] ?? null}
      />
    );
  }
  return (
    <div className="flex max-h-40 flex-wrap gap-4 overflow-y-auto">
      {options.map((option) => (
        <Field className="w-auto" key={option.value} orientation="horizontal">
          <Checkbox
            checked={ids.includes(option.value)}
            disabled={disabled}
            id={`${rowId}-${option.value}`}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...ids, option.value]
                  : ids.filter((id) => id !== option.value)
              )
            }
          />
          <FieldLabel htmlFor={`${rowId}-${option.value}`}>
            {option.label}
          </FieldLabel>
        </Field>
      ))}
    </div>
  );
}
