import type { z } from "zod";
import { dataExportCsvSpec } from "../definition/specs/data-export-csv";
import {
  defineBatchNode,
  type FlowItem,
  FlowItemError,
  type JsonObject,
  type NodeBatchInput,
  type NodeContext,
} from "../registry/define-node";

const FORMULA = /^[\s]*[=+@-]|^[\t\r\n]/;
export const csvCell = (value: unknown): string => {
  let text = "";
  if (value !== null && value !== undefined) {
    text = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  if (typeof value !== "number" && FORMULA.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
};

type ExportInput = NodeBatchInput<
  z.infer<typeof dataExportCsvSpec.configSchema>
>;
const readRows = (
  template: string,
  ctx: NodeContext,
  item: FlowItem
): JsonObject[] => {
  const rows: unknown = template ? ctx.resolve(template, item) : [item.json];
  if (!Array.isArray(rows)) {
    throw new FlowItemError("CSV rows must resolve to an array.");
  }
  if (
    rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new FlowItemError("Each CSV row must be an object.");
  }
  return rows as JsonObject[];
};

const saveCsv = async ({
  config,
  ctx,
  items,
}: ExportInput): Promise<JsonObject> => {
  const [first] = items;
  if (!(first && ctx.storage.writeAsset)) {
    throw new FlowItemError("Export storage or input is unavailable.");
  }
  const lines = [
    config.columns
      .map((column) => csvCell(column.header))
      .join(config.delimiter),
  ];
  let rowCount = 0;
  let bytes = Buffer.byteLength(lines[0] ?? "");
  for (const item of items) {
    ctx.signal.throwIfAborted();
    for (const row of readRows(config.rows, ctx, item)) {
      const line = config.columns
        .map((column) =>
          csvCell(ctx.resolve(column.value, { ...item, json: row }))
        )
        .join(config.delimiter);
      bytes += Buffer.byteLength(line) + 2;
      if (bytes > 50_000_000) {
        throw new FlowItemError("CSV export exceeds 50 MB. Narrow the input.");
      }
      lines.push(line);
      rowCount += 1;
    }
  }
  const file = await ctx.storage.writeAsset({
    body: new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`),
    contentType: "text/csv; charset=utf-8",
    fileName: String(ctx.resolve(config.fileName, first) ?? "customers.csv"),
  });
  const saved = { ...file, rowCount };
  await ctx.stepState.set("csvExport", saved);
  return saved;
};

export const dataExportCsvNode = defineBatchNode(
  dataExportCsvSpec,
  async (input) => {
    const saved =
      (await input.ctx.stepState.get<JsonObject>("csvExport")) ??
      (await saveCsv(input));
    return {
      results: input.items.map((item, index) => ({
        key: item.key,
        outputs: index === 0 ? [{ handle: "main", json: saved }] : [],
      })),
    };
  }
);
