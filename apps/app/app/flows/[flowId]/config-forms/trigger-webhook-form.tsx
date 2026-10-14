"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@repo/design-system/components/ui/combobox";
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
      <Combobox
        disabled={disabled}
        inputValue={asString(config.topic)}
        items={COMMON_TOPICS}
        onInputValueChange={(topic) =>
          onChange({ ...config, topic: topic.trim().toUpperCase() })
        }
      >
        <ComboboxInput
          aria-label="Webhook topic"
          className="w-full"
          placeholder="ORDERS_CREATE"
        />
        <ComboboxContent>
          <ComboboxEmpty>No common topic matches.</ComboboxEmpty>
          <ComboboxList>
            {(topic: string) => (
              <ComboboxItem key={topic} value={topic}>
                {topic}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}
