import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const shopifyAddTagsSpec = defineNodeSpec({
  category: "action",
  concurrency: 4,
  configSchema: z.object({
    /** A template for the resource to tag, such as {{ $json.order.id }}. */
    resourceId: z.string().min(1).max(500),
    tags: z.array(z.string().min(1).max(255)).min(1).max(50),
  }),
  description:
    "Adds tags to an order, customer, product or draft order. Tags already present are left as they are.",
  idempotent: true,
  label: "Add tags",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "shopify.addTags",
});
