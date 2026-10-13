"use client";

import { Input } from "@repo/design-system";
import { asString, type ConfigFormProps, Field } from "./form-parts";

/** Topics people reach for first; any other topic name can be typed. */
const COMMON_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_PAID",
  "ORDERS_CANCELLED",
  "ORDERS_FULFILLED",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
  "INVENTORY_LEVELS_UPDATE",
  "DRAFT_ORDERS_CREATE",
  "FULFILLMENTS_CREATE",
];

export function TriggerWebhookForm({
  config,
  disabled,
  onChange,
}: ConfigFormProps) {
  return (
    <Field
      hint="The webhook's payload becomes the item, so its fields are read as {{ $json.field }}. The flow starts running for a store once it is activated there."
      label="Topic"
    >
      <Input
        aria-label="Webhook topic"
        disabled={disabled}
        list="webhook-topics"
        onChange={(event) =>
          onChange({
            ...config,
            topic: event.target.value.trim().toUpperCase(),
          })
        }
        placeholder="ORDERS_CREATE"
        value={asString(config.topic)}
      />
      <datalist id="webhook-topics">
        {COMMON_TOPICS.map((topic) => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
    </Field>
  );
}
