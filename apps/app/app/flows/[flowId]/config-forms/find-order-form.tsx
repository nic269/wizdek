"use client";

import { OptionSelect } from "../../../lib/option-select";
import { TemplateInput } from "../template-input";
import { asString, type ConfigFormProps, Field } from "./form-parts";

export function FindOrderForm({
  config,
  disabled,
  onChange,
  sampleFields,
}: ConfigFormProps) {
  const by = asString(config.by, "name");

  return (
    <div className="space-y-4">
      <Field label="Find the order by">
        <OptionSelect
          aria-label="Find the order by"
          disabled={disabled}
          onValueChange={(value) => onChange({ ...config, by: value })}
          options={[
            { label: "Order name, such as #1001", value: "name" },
            { label: "Order ID", value: "id" },
          ]}
          value={by}
        />
      </Field>
      <Field
        hint="The order is added to the item as order, with id, name, tags, totalPrice and currencyCode."
        label={by === "id" ? "Order ID" : "Order name"}
      >
        <TemplateInput
          disabled={disabled}
          label="Order value"
          onChange={(value) => onChange({ ...config, value })}
          placeholder="{{ $json.Order }}"
          sampleFields={sampleFields}
          value={asString(config.value)}
        />
      </Field>
    </div>
  );
}
