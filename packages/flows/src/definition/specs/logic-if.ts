import { z } from "zod";
import { CONDITION_OPERATORS } from "../conditions";
import { defineNodeSpec } from "../node-spec";

export const IF_TRUE_OUTPUT = "true";
export const IF_FALSE_OUTPUT = "false";

export const conditionSchema = z.object({
  left: z.string().max(500),
  operator: z.enum(CONDITION_OPERATORS),
  right: z.string().max(500).default(""),
  valueType: z.enum(["string", "number"]).default("string"),
});

export const logicIfSpec = defineNodeSpec({
  category: "logic",
  configSchema: z.object({
    combinator: z.enum(["all", "any"]).default("all"),
    conditions: z.array(conditionSchema).min(1).max(20),
  }),
  description: "Sends each item down the true or false branch.",
  idempotent: true,
  label: "If",
  mode: "item",
  outputs: [IF_TRUE_OUTPUT, IF_FALSE_OUTPUT],
  type: "logic.if",
});
