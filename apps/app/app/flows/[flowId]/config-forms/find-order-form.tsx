"use client";

import { TemplateInput } from "../template-input";
import {
  asString,
  type ConfigFormProps,
  Field,
  selectClassName,
} from "./form-parts";

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
        <select
          aria-label="Find the order by"
          className={selectClassName}
          disabled={disabled}
          onChange={(event) => onChange({ ...config, by: event.target.value })}
          value={by}
        >
          <option value="name">Order name, such as #1001</option>
          <option value="id">Order ID</option>
        </select>
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
