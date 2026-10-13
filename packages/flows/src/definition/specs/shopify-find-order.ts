import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const shopifyFindOrderSpec = defineNodeSpec({
  category: "action",
  concurrency: 4,
  configSchema: z.object({
    by: z.enum(["name", "id"]).default("name"),
    /** A template for the order name (#1001) or id. */
    value: z.string().min(1, "Say which order to look up.").max(500),
  }),
  description:
    "Looks an order up in the store and adds it to the item as `order`.",
  idempotent: true,
  label: "Find order",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "shopify.findOrder",
});
