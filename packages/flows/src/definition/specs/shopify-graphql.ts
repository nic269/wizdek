import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

const MUTATION_KEYWORD = /\bmutation\b/;

/**
 * Whether a document may contain a mutation. Deliberately cautious: any use
 * of the word counts, so a document is never wrongly treated as safe to
 * repeat. The cost of a false alarm is only that a query is not retried.
 */
export const mayMutate = (document: string): boolean =>
  MUTATION_KEYWORD.test(document);

export const shopifyGraphqlSpec = defineNodeSpec({
  category: "action",
  concurrency: 4,
  configSchema: z.object({
    /** One Admin GraphQL query or mutation. */
    document: z
      .string()
      .min(1, "Write the query or mutation to run.")
      .max(50_000),
    /**
     * Where in the response to read the result from, such as
     * `orderUpdate.order`. Empty keeps the whole `data` object.
     */
    resultPath: z.string().max(200).default(""),
    /** The variables as JSON; text values may contain templates. */
    variables: z
      .string()
      .max(50_000)
      .default("{}")
      .refine((text) => {
        try {
          const parsed: unknown = JSON.parse(text);
          return (
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed)
          );
        } catch {
          return false;
        }
      }, "Variables must be a JSON object."),
  }),
  description:
    "Runs any Admin GraphQL query or mutation for each item and adds the result as `result`.",
  // A query can be repeated freely; a mutation cannot.
  idempotent: (config) => !mayMutate(config.document),
  label: "GraphQL request",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "shopify.graphql",
});
