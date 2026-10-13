import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

/** Shopify's limit on the uploaded variables file. */
export const MAX_BULK_FILE_BYTES = 100_000_000;

const MUTATION_KEYWORD = /\bmutation\b/;

const isJsonObject = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
};

export const shopifyBulkMutationSpec = defineNodeSpec({
  category: "action",
  configSchema: z.object({
    /** The mutation Shopify runs once for every item. */
    mutation: z
      .string()
      .min(1, "Write the mutation to run for every item.")
      .max(50_000)
      .refine(
        (text) => MUTATION_KEYWORD.test(text),
        "A bulk operation needs a mutation."
      ),
    /** Seconds between checks on the operation's progress. */
    pollIntervalSeconds: z.number().int().min(1).max(60).default(5),
    /** The mutation's variables for one item, as JSON with templates. */
    variables: z
      .string()
      .max(50_000)
      .refine(isJsonObject, "Variables must be a JSON object."),
  }),
  description:
    "Runs one mutation for all items as a single Shopify bulk operation. Suited to tens of thousands of items.",
  // The whole batch is submitted once and never submitted again.
  idempotent: false,
  label: "Bulk mutation",
  mode: "batch",
  outputs: [MAIN_OUTPUT],
  type: "shopify.bulkMutation",
});
