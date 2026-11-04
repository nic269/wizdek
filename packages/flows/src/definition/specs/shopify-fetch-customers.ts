import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const shopifyFetchCustomersSpec = defineNodeSpec({
  category: "action",
  configSchema: z.object({
    fields: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .default(
        "id firstName lastName defaultEmailAddress { emailAddress } tags"
      ),
    pageSize: z.number().int().min(1).max(250).default(100),
    query: z.string().max(2000).default(""),
    sortKey: z.enum(["ID", "CREATED_AT", "UPDATED_AT"]).default("ID"),
  }),
  description:
    "Reads customers with configurable GraphQL fields and cursor pagination. Emits one item per page in rows. Requires read_customers.",
  idempotent: true,
  label: "Fetch customers",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "shopify.fetchCustomers",
});
