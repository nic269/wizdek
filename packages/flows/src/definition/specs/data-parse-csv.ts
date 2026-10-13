import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const dataParseCsvSpec = defineNodeSpec({
  category: "data",
  configSchema: z.object({
    delimiter: z.enum([",", ";", "\t", "|"]).default(","),
    /** A template that resolves to an uploaded file, such as {{ $json.csvFile }}. */
    file: z.string().min(1).max(500),
    hasHeader: z.boolean().default(true),
    skipEmptyRows: z.boolean().default(true),
    trimValues: z.boolean().default(true),
  }),
  description: "Reads an uploaded CSV file and emits one item per row.",
  idempotent: true,
  label: "Parse CSV",
  mode: "item",
  outputs: [MAIN_OUTPUT],
  type: "data.parseCsv",
});
