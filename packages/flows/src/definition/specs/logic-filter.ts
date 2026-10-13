import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";
import { conditionSchema } from "./logic-if";

export const logicFilterSpec = defineNodeSpec({
  category: "logic",
  configSchema: z.object({
    combinator: z.enum(["all", "any"]).default("all"),
    conditions: z
      .array(conditionSchema)
      .min(1, "Add at least one condition.")
      .max(20),
  }),
  description: "Keeps the items that match and drops the rest.",
  idempotent: true,
  label: "Filter",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "logic.filter",
});
