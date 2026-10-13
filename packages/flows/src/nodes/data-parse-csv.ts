import { parse } from "csv-parse/sync";
import { MAIN_OUTPUT } from "../definition/node-spec";
import { dataParseCsvSpec } from "../definition/specs/data-parse-csv";
import { defineNode, FlowItemError } from "../registry/define-node";

const describeParseError = (error: unknown) =>
  error instanceof Error ? error.message : "The file could not be read as CSV.";

/**
 * Turns an uploaded CSV file into one item per row. With a header row each
 * item is keyed by column name; without one, columns are named column1,
 * column2 and so on.
 */
export const dataParseCsvNode = defineNode(
  dataParseCsvSpec,
  async ({ config, ctx, item }) => {
    const assetId = ctx.resolve(config.file, item);
    if (typeof assetId !== "string" || !assetId) {
      throw new FlowItemError(
        "The file setting did not resolve to an uploaded file."
      );
    }
    const asset = await ctx.storage.readAsset(assetId);

    let rows: Record<string, string>[];
    try {
      const parsed: unknown = parse(Buffer.from(asset.body), {
        bom: true,
        columns: config.hasHeader,
        delimiter: config.delimiter,
        skip_empty_lines: config.skipEmptyRows,
        trim: config.trimValues,
      });
      rows = config.hasHeader
        ? (parsed as Record<string, string>[])
        : (parsed as string[][]).map((cells) =>
            Object.fromEntries(
              cells.map((cell, index) => [`column${index + 1}`, cell])
            )
          );
    } catch (error) {
      throw new FlowItemError(
        `"${asset.fileName}" is not valid CSV: ${describeParseError(error)}`
      );
    }

    return {
      outputs: rows.map((row, index) => ({
        handle: MAIN_OUTPUT,
        // The row number as a person sees it in a spreadsheet.
        json: { ...row, $row: index + (config.hasHeader ? 2 : 1) },
      })),
    };
  }
);
