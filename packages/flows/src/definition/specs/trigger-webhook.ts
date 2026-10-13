import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const triggerWebhookSpec = defineNodeSpec({
  category: "trigger",
  configSchema: z.object({
    /** A Shopify webhook topic by its enum name, such as ORDERS_CREATE. */
    topic: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/, "Use a topic name such as ORDERS_CREATE."),
  }),
  description:
    "Starts the flow when the store sends a webhook, with the webhook's payload as the item.",
  idempotent: true,
  label: "Shopify webhook",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "trigger.webhook",
});
