import { z } from "zod";
import { defineNodeSpec } from "../node-spec";

export const SWITCH_DEFAULT_OUTPUT = "default";

const caseSchema = z.object({
  /** The output this case sends matching items to. */
  name: z
    .string()
    .min(1, "Give the case a name.")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, hyphens and underscores.")
    .refine((name) => name !== SWITCH_DEFAULT_OUTPUT, {
      message: "“default” is reserved for items that match no case.",
    }),
  /** The item goes to this case when the value equals this text. */
  value: z.string().max(500),
});

export const logicSwitchSpec = defineNodeSpec({
  category: "logic",
  configSchema: z.object({
    cases: z
      .array(caseSchema)
      .min(1, "Add at least one case.")
      .max(20)
      .refine(
        (cases) => new Set(cases.map(({ name }) => name)).size === cases.length,
        "Case names must be different from each other."
      ),
    /** A template for the value to compare, such as {{ $json.country }}. */
    value: z.string().min(1, "Choose the value to route by.").max(500),
  }),
  description:
    "Sends each item to the output of the first case its value equals, or to “default”.",
  idempotent: true,
  label: "Switch",
  mode: "item",
  outputs: (config) => [
    ...config.cases.map(({ name }) => name),
    SWITCH_DEFAULT_OUTPUT,
  ],
  type: "logic.switch",
});
