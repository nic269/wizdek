import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const manualInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][\w]*$/, "Use a name like csvFile."),
  label: z.string().min(1).max(120),
  type: z.enum(["file", "text", "number"]),
});

export const triggerManualSpec = defineNodeSpec({
  category: "trigger",
  configSchema: z.object({
    /** Values the person starting the run is asked for. */
    inputs: z.array(manualInputSchema).max(20).default([]),
  }),
  description:
    "Starts the flow when someone runs it, with the inputs they provide.",
  idempotent: true,
  label: "Manual trigger",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "trigger.manual",
});
