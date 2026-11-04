import { z } from "zod";
import { defineNodeSpec, MAIN_OUTPUT } from "../node-spec";

export const dataExportCsvSpec = defineNodeSpec({
  category: "data",
  configSchema: z.object({
    columns: z
      .array(
        z.object({
          header: z.string().min(1).max(200),
          value: z.string().max(2000),
        })
      )
      .min(1)
      .max(200)
      .default([{ header: "ID", value: "{{ $json.id }}" }]),
    delimiter: z.enum([",", ";", "\t"]).default(","),
    fileName: z.string().min(1).max(200).default("customers.csv"),
    rows: z
      .string()
      .max(500)
      .default("{{ $json.rows }}")
      .describe(
        "Array template; leave empty to export each incoming item as a row."
      ),
  }),
  description:
    "Maps incoming rows to CSV columns and saves a downloadable file on the run.",
  idempotent: true,
  label: "Export CSV",
  mode: "batch",
  outputs: [MAIN_OUTPUT],
  type: "data.exportCsv",
});
