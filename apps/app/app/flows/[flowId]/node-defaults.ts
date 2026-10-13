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
  "data.setFields": { remove: [], rename: [], set: [] },
  "logic.filter": {
    combinator: "all",
    conditions: [{ left: "", operator: "eq", right: "", valueType: "string" }],
  },
  "logic.if": {
    combinator: "all",
    conditions: [{ left: "", operator: "eq", right: "", valueType: "string" }],
  },
  "logic.switch": { cases: [{ name: "", value: "" }], value: "" },
  "shopify.addTags": { resourceId: "", tags: [] },
  "shopify.findOrder": { by: "name", value: "" },
  "shopify.graphql": { document: "", resultPath: "", variables: "{}" },
  "trigger.manual": { inputs: [] },
  "trigger.schedule": { cron: "0 6 * * *", timezone: "UTC" },
  "trigger.webhook": { topic: "ORDERS_CREATE" },
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
