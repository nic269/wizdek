import type { PoolClient } from "pg";
import { invariant } from "../errors";
import type { Connection } from "../profiles/schema";
import { directObject, MAX_FILE_BYTES } from "./direct-storage";
import { scopedWorkflow } from "./workflow-logs";

// Mirrors OMS import-type-registry template order; retained locally for removable integration.
const COLUMNS: Record<string, string[]> = {
  COURIER_VIAF: [],
  DHL_SHIPPING_LABEL: [
    "Order Number",
    "Request Type",
    "Planned Shipping Date Time",
    "skus",
  ],
  FRAUD_CHECK: ["ORDER#"],
  OOS: [
    "REQUESTDATE (mm/dd/yyyy)",
    "ITEM#",
    "COL",
    "SZ",
    "QTY",
    "FROM",
    "TO",
    "ORDER#",
  ],
  ORDER_DELAY_UPDATE: [
    "REQUESTDATE (mm/dd/yyyy)",
    "ITEM#",
    "COL",
    "SZ",
    "QTY",
    "FROM",
    "TO",
    "ORDER#",
    "Morning Number",
    "Remarks",
  ],
  ORDER_DISPATCH: ["HK - Ship Date (mm/dd/yyyy)", "ORDER NO"],
  RETURN_ARRIVALS: ["Order Name", "SKU", "QTY"],
  UPDATE_TRACKING: [
    "Name",
    "Fulfillment: Tracking Company",
    "Fulfillment: Tracking Number",
  ],
};
export interface ImportFile {
  content: Buffer;
  contentType: string;
  disposition: string;
}
export function originalFileAccount(
  connection: Pick<Connection, "globalDiagnostics" | "accountIds">,
  accountId: unknown
): { accountId?: string } {
  if (accountId === null) {
    invariant(
      connection.globalDiagnostics,
      "account_denied",
      "Account-less workflows require global diagnostics.",
      403
    );
    return {};
  }
  invariant(
    typeof accountId === "string" &&
      accountId.length > 0 &&
      (connection.globalDiagnostics ||
        connection.accountIds.includes(accountId)),
    "account_denied",
    "Workflow account is not in this connection scope.",
    403
  );
  return { accountId };
}
const CSV_SPECIAL = /[",\n\r]/;

export function attachment(
  fileName: string,
  contentType: string,
  content: Buffer
): ImportFile {
  invariant(
    content.length <= MAX_FILE_BYTES,
    "file_size_limit",
    "The original file exceeds the 50 MB download limit.",
    413
  );
  return {
    content,
    contentType: contentType || "application/octet-stream",
    disposition: `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._ -]+/g, "_") || "original-file"}"`,
  };
}

export function reconstructedCsv(importType: string, payloads: unknown[]) {
  const defaults = COLUMNS[importType];
  invariant(
    defaults,
    "original_import_file_not_found",
    "The original import file is not available for this import type.",
    404
  );
  const records = payloads.map((value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  );
  const extras = [
    ...new Set(
      records.flatMap(Object.keys).filter((key) => !defaults.includes(key))
    ),
  ];
  const columns = [...defaults, ...extras];
  const cell = (value: unknown) => {
    let text = "";
    if (value !== null && value !== undefined) {
      text = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    return CSV_SPECIAL.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return Buffer.from(
    `\uFEFF${[columns, ...records.map((row) => columns.map((key) => row[key]))].map((row) => row.map(cell).join(",")).join("\n")}\n`,
    "utf8"
  );
}

export async function workflowImportFile(
  db: PoolClient,
  connection: Connection,
  id: string,
  accountId?: string
) {
  const run = await scopedWorkflow(db, connection, id);
  if (accountId !== undefined) {
    originalFileAccount(connection, accountId);
    invariant(
      run.accountId === accountId,
      "account_denied",
      "The workflow does not belong to the selected account.",
      403
    );
  }
  const available = await db.query(
    `SELECT CASE WHEN to_regclass('public.import_batch') IS NULL THEN false ELSE has_table_privilege(current_user,'public.import_batch','SELECT') END AS batch, CASE WHEN to_regclass('public.import_uploaded_file') IS NULL THEN false ELSE has_table_privilege(current_user,'public.import_uploaded_file','SELECT') END AS upload`
  );
  invariant(
    available.rows[0]?.batch && available.rows[0]?.upload,
    "import_storage_unavailable",
    "This database does not expose import file metadata. Check its schema and read permissions.",
    409
  );
  const batches = await db.query(
    `SELECT b.id,b."importType",b."fileName",f."storageType",f."storageKey",f."fileName" AS "originalName",f."mimeType",octet_length(f."contentText") AS "contentBytes" FROM import_batch b LEFT JOIN import_uploaded_file f ON f."batchId"=b.id WHERE b."workflowRunId"=$1 LIMIT 1`,
    [id]
  );
  const [batch] = batches.rows;
  invariant(
    batch,
    "import_batch_not_found",
    "No import batch is associated with this workflow.",
    404
  );
  if (batch.storageKey && ["S3", "R2"].includes(batch.storageType)) {
    const object = await directObject(connection, batch.storageKey);
    return attachment(
      batch.originalName,
      object.contentType || batch.mimeType,
      object.content
    );
  }
  invariant(
    Number(batch.contentBytes ?? 0) <= MAX_FILE_BYTES * 1.4,
    "file_size_limit",
    "The original file exceeds the download limit.",
    413
  );
  if (batch.storageType === "DB_TEXT" && Number(batch.contentBytes) > 0) {
    const uploaded = await db.query(
      `SELECT "contentText" FROM import_uploaded_file WHERE "batchId"=$1`,
      [batch.id]
    );
    const content = Buffer.from(
      uploaded.rows[0].contentText,
      batch.mimeType === "application/pdf" ? "base64" : "utf8"
    );
    return attachment(batch.originalName, batch.mimeType, content);
  }
  invariant(
    COLUMNS[batch.importType],
    "original_import_file_not_found",
    "The original import file is no longer available.",
    404
  );
  const sizes = await db.query(
    `SELECT count(*)::int AS count,COALESCE(sum(octet_length(payload::text)),0)::bigint AS bytes FROM import_batch_row WHERE "batchId"=$1`,
    [batch.id]
  );
  invariant(
    Number(sizes.rows[0].count) <= 100_000 &&
      Number(sizes.rows[0].bytes) <= MAX_FILE_BYTES,
    "file_size_limit",
    "Reconstructing this file exceeds the download limit. Download it from OMS instead.",
    413
  );
  const rows = await db.query(
    `SELECT payload FROM import_batch_row WHERE "batchId"=$1 ORDER BY "rowNumber"`,
    [batch.id]
  );
  return attachment(
    batch.fileName || `${batch.id}.csv`,
    "text/csv; charset=utf-8",
    reconstructedCsv(
      batch.importType,
      rows.rows.map((row) => row.payload)
    )
  );
}
