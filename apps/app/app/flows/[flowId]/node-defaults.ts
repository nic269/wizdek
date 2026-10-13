import { builtInNodeSpecs } from "@repo/flows/definition";

/**
 * Starting configuration for node types whose required fields have no
 * default. Other types start from their schema's own defaults.
 */
const STARTING_CONFIG: Record<string, Record<string, unknown>> = {
  "data.parseCsv": {
    delimiter: ",",
    file: "",
    hasHeader: true,
    skipEmptyRows: true,
    trimValues: true,
  },
  "logic.if": {
    combinator: "all",
    conditions: [{ left: "", operator: "eq", right: "", valueType: "string" }],
  },
  "shopify.addTags": { resourceId: "", tags: [] },
  "shopify.findOrder": { by: "name", value: "" },
  "trigger.manual": { inputs: [] },
};

export const specsByType = new Map(
  builtInNodeSpecs.map((spec) => [spec.type, spec])
);

export const createStartingConfig = (
  nodeType: string
): Record<string, unknown> => {
  const known = STARTING_CONFIG[nodeType];
  if (known) {
    return structuredClone(known);
  }
  const parsed = specsByType.get(nodeType)?.configSchema.safeParse({});
  return parsed?.success ? (parsed.data as Record<string, unknown>) : {};
};
