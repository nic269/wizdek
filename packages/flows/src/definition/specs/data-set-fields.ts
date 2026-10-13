import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

const fieldName = z
  .string()
  .min(1, "Name the field.")
  .max(120)
  .refine(
    (name) => !["__proto__", "constructor", "prototype"].includes(name),
    "That field name is not allowed."
  );

export const dataSetFieldsSpec = defineNodeSpec({
  category: "data",
  configSchema: z.object({
    /** Fields to drop from the item, applied last. */
    remove: z.array(fieldName).max(50).default([]),
    /** Fields to rename, applied before setting. */
    rename: z
      .array(z.object({ from: fieldName, to: fieldName }))
      .max(50)
      .default([]),
    /** Fields to add or overwrite. */
    set: z
      .array(
        z.object({
          name: fieldName,
          type: z.enum(["auto", "string", "number", "boolean"]).default("auto"),
          /** A template or fixed text for the field's value. */
          value: z.string().max(2000),
        })
      )
      .max(50)
      .default([]),
  }),
  description: "Adds, renames and removes fields on each item.",
  idempotent: true,
  label: "Set fields",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "data.setFields",
});
