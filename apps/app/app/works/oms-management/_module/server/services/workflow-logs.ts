import type { PoolClient } from "pg";
import { z } from "zod";
import { invariant } from "../errors";
import type { Connection } from "../profiles/schema";
import { redact } from "../redact";

export const filterSchema = z.object({
  actorId: z.string().max(128).optional(),
  cursorDate: z.string().datetime().optional(),
  cursorId: z.string().max(128).optional(),
  featureKey: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  module: z.string().max(80).optional(),
  search: z.string().max(200).optional(),
  shopDomain: z.string().max(253).optional(),
  status: z.string().max(40).optional(),
  to: z.string().datetime().optional(),
});

const MAX_BUNDLE_ROWS = 50_000;
const MAX_DIAGNOSTIC_BYTES = 20 * 1024 * 1024;
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function workflowTimestamps(
  row: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...row };
  // JSON projections bypass pg's column type parsers. Prisma's naive timestamps are UTC.
  for (const key of ["startedAt", "updatedAt"]) {
    const value = result[key];
    if (typeof value === "string") {
      result[key] = new Date(
        NAIVE_TIMESTAMP.test(value) ? `${value}Z` : value
      ).toISOString();
    }
  }
  return result;
}
// Optional columns are projected explicitly so older OMS schemas remain readable.
const RUN_FIELDS = `w.id,w."accountId",w."actorId",w.module,w."featureKey",w."workflowKey",w.status,w.title,w."createdAt",w."completedAt",
  to_jsonb(w)->'targetType' AS "targetType",to_jsonb(w)->'targetId' AS "targetId",
  COALESCE(to_jsonb(w)->>'startedAt',to_jsonb(w)->>'createdAt') AS "startedAt",to_jsonb(w)->'durationMs' AS "durationMs",to_jsonb(w)->'updatedAt' AS "updatedAt",to_jsonb(w)->'logSequence' AS "logSequence"`;
const LOG_FIELDS = `l.id,l."workflowRunId",to_jsonb(l)->'parentLogId' AS "parentLogId",l.sequence,l.level,l.stage,l.event,l.status,l.message,l."rowNumber",l."shopDomain",l."errorName",l."errorCode",l."errorMessage",l."createdAt",
  to_jsonb(l)->'targetType' AS "targetType",to_jsonb(l)->'targetId' AS "targetId",to_jsonb(l)->'operationName' AS "operationName",to_jsonb(l)->'durationMs' AS "durationMs",
  to_jsonb(l)->'metadata' AS metadata,to_jsonb(l)->'errorDetails' AS "errorDetails"`;

function requireScope(connection: Connection) {
  invariant(
    connection.globalDiagnostics || connection.accountIds.length > 0,
    "account_scope_required",
    "Configure account scope or global diagnostics.",
    403
  );
}

function bounded<T>(value: T): T {
  invariant(
    Buffer.byteLength(JSON.stringify(value)) <= MAX_DIAGNOSTIC_BYTES,
    "diagnostics_size_limit",
    "This workflow payload exceeds the 20 MB diagnostic limit. Narrow the selection or inspect the source database.",
    413
  );
  return value;
}

async function actors(db: PoolClient, rows: Record<string, unknown>[]) {
  const ids = [...new Set(rows.map((row) => row.actorId).filter(Boolean))];
  if (!ids.length) {
    return rows.map((row) => ({ ...row, actor: null }));
  }
  const permissions = await db.query(
    `SELECT CASE WHEN to_regclass('public.user') IS NULL THEN false ELSE has_table_privilege(current_user,'public.user','SELECT') END AS allowed`
  );
  if (!permissions.rows[0]?.allowed) {
    return rows.map((row) => ({ ...row, actor: null }));
  }
  const result = await db.query(
    `SELECT id,name,email,to_jsonb(u)->'roleCode' AS "roleCode" FROM "user" u WHERE id=ANY($1::text[])`,
    [ids]
  );
  const byId = new Map(result.rows.map((actor) => [actor.id, actor]));
  return rows.map((row) => ({ ...row, actor: byId.get(row.actorId) ?? null }));
}

async function siteTimezone(db: PoolClient) {
  const available = await db.query(
    `SELECT CASE WHEN to_regclass('public.site_setting') IS NULL THEN false ELSE has_table_privilege(current_user,'public.site_setting','SELECT') END AS allowed`
  );
  if (!available.rows[0]?.allowed) {
    return "Asia/Hong_Kong";
  }
  const result = await db.query(
    `SELECT value FROM site_setting WHERE key='siteTimezone'`
  );
  const zone = result.rows[0]?.value || "Asia/Hong_Kong";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
    return zone as string;
  } catch {
    return "Asia/Hong_Kong";
  }
}

export async function workflowOptions(db: PoolClient, connection: Connection) {
  requireScope(connection);
  const result = await db.query(
    `SELECT DISTINCT module::text AS module,"featureKey" FROM workflow_run WHERE ($1::boolean OR "accountId"=ANY($2::text[])) ORDER BY module,"featureKey" LIMIT 2000`,
    [connection.globalDiagnostics, connection.accountIds]
  );
  return {
    featureKeys: [...new Set(result.rows.map((row) => String(row.featureKey)))],
    modules: [...new Set(result.rows.map((row) => String(row.module)))],
    timeZone: await siteTimezone(db),
  };
}

export async function workflowRuns(
  db: PoolClient,
  connection: Connection,
  input: unknown
) {
  requireScope(connection);
  const f = filterSchema.parse(input);
  const values: unknown[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = connection.globalDiagnostics
    ? []
    : [`w."accountId"=ANY(${add(connection.accountIds)}::text[])`];
  for (const column of ["module", "featureKey", "status", "actorId"] as const) {
    if (f[column]) {
      conditions.push(`w."${column}"::text=${add(f[column])}`);
    }
  }
  if (f.from) {
    conditions.push(
      `w."createdAt">=(${add(f.from)}::timestamptz AT TIME ZONE 'UTC')`
    );
  }
  if (f.to) {
    conditions.push(
      `w."createdAt"<=(${add(f.to)}::timestamptz AT TIME ZONE 'UTC')`
    );
  }
  if (f.cursorDate && f.cursorId) {
    conditions.push(
      `(w."createdAt",w.id)<((${add(f.cursorDate)}::timestamptz AT TIME ZONE 'UTC'),${add(f.cursorId)})`
    );
  }
  if (f.shopDomain) {
    conditions.push(
      `EXISTS(SELECT 1 FROM workflow_run_log l WHERE l."workflowRunId"=w.id AND l."shopDomain" ILIKE ${add(`%${f.shopDomain}%`)})`
    );
  }
  if (f.search) {
    const p = add(`%${f.search}%`);
    conditions.push(
      `(w.title ILIKE ${p} OR w.id ILIKE ${p} OR w."featureKey" ILIKE ${p} OR w."workflowKey" ILIKE ${p} OR to_jsonb(w)->>'targetId' ILIKE ${p} OR EXISTS(SELECT 1 FROM workflow_run_log l WHERE l."workflowRunId"=w.id AND (l.message ILIKE ${p} OR l."errorMessage" ILIKE ${p} OR l."shopDomain" ILIKE ${p})))`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT ${RUN_FIELDS} FROM workflow_run w ${where} ORDER BY w."createdAt" DESC,w.id DESC LIMIT ${add(f.limit + 1)}`,
    values
  );
  const rows = result.rows.slice(0, f.limit);
  const ids = rows.map((row) => row.id);
  const counts = ids.length
    ? await db.query(
        `SELECT "workflowRunId",count(*)::int AS "logCount",count(*) FILTER(WHERE upper(level::text)='ERROR')::int AS "errorCount",count(*) FILTER(WHERE upper(level::text)='WARN')::int AS "warningCount" FROM workflow_run_log WHERE "workflowRunId"=ANY($1::text[]) GROUP BY "workflowRunId"`,
        [ids]
      )
    : { rows: [] };
  const byId = new Map(counts.rows.map((row) => [row.workflowRunId, row]));
  const previews = ids.length
    ? await db.query(
        `SELECT "workflowRunId",id,stage,event,left(message,2000) AS message,left("errorMessage",2000) AS "errorMessage","rowNumber","shopDomain","createdAt" FROM (SELECT l.*,row_number() OVER(PARTITION BY "workflowRunId" ORDER BY "createdAt" DESC,sequence DESC) AS rank FROM workflow_run_log l WHERE "workflowRunId"=ANY($1::text[]) AND upper(level::text)='ERROR') errors WHERE rank<=2`,
        [ids]
      )
    : { rows: [] };
  const enriched = await actors(
    db,
    rows.map((row) => ({
      ...workflowTimestamps(row),
      errorCount: byId.get(row.id)?.errorCount ?? 0,
      logCount: byId.get(row.id)?.logCount ?? 0,
      logs: previews.rows.filter((log) => log.workflowRunId === row.id),
      warningCount: byId.get(row.id)?.warningCount ?? 0,
    }))
  );
  const last = rows.at(-1);
  return bounded(
    redact({
      next:
        result.rows.length > f.limit && last
          ? { cursorDate: last.createdAt, cursorId: last.id }
          : null,
      rows: enriched,
    })
  );
}

export async function scopedWorkflow(
  db: PoolClient,
  connection: Connection,
  id: string
) {
  const result = await db.query(
    `SELECT ${RUN_FIELDS},to_jsonb(w)->'summary' AS summary FROM workflow_run w WHERE id=$1 AND ($2::boolean OR "accountId"=ANY($3::text[]))`,
    [id, connection.globalDiagnostics, connection.accountIds]
  );
  invariant(
    result.rows[0],
    "not_found",
    "Workflow was not found in this account scope.",
    404
  );
  return workflowTimestamps(result.rows[0]);
}

async function runWithCounts(
  db: PoolClient,
  connection: Connection,
  id: string
) {
  const run = await scopedWorkflow(db, connection, id);
  const counts = await db.query(
    `SELECT count(*)::int AS "logCount",count(*) FILTER(WHERE upper(level::text)='ERROR')::int AS "errorCount",count(*) FILTER(WHERE upper(level::text)='WARN')::int AS "warningCount" FROM workflow_run_log WHERE "workflowRunId"=$1`,
    [id]
  );
  return (await actors(db, [{ ...run, ...counts.rows[0] }]))[0];
}

export async function workflowDetail(
  db: PoolClient,
  connection: Connection,
  id: string,
  after: number
) {
  const run = await runWithCounts(db, connection, id);
  const logs = await db.query(
    `SELECT ${LOG_FIELDS} FROM workflow_run_log l WHERE "workflowRunId"=$1 AND sequence>$2 ORDER BY sequence LIMIT 101`,
    [id, after]
  );
  return bounded(
    redact({
      logs: logs.rows.slice(0, 100),
      nextSequence: logs.rows.length > 100 ? logs.rows[99].sequence : null,
      run,
    })
  );
}

export async function workflowBundle(
  db: PoolClient,
  connection: Connection,
  id: string
) {
  const run = await runWithCounts(db, connection, id);
  const size = await db.query(
    `SELECT count(*)::int AS count,COALESCE(sum(octet_length(to_jsonb(l)::text)),0)::bigint AS bytes FROM workflow_run_log l WHERE "workflowRunId"=$1`,
    [id]
  );
  invariant(
    Number(size.rows[0].count) <= MAX_BUNDLE_ROWS &&
      Number(size.rows[0].bytes) <= MAX_DIAGNOSTIC_BYTES,
    "bundle_size_limit",
    "This bundle exceeds 50,000 entries or 20 MB. Inspect it in the source database instead.",
    413
  );
  const logs = await db.query(
    `SELECT ${LOG_FIELDS} FROM workflow_run_log l WHERE "workflowRunId"=$1 ORDER BY sequence`,
    [id]
  );
  return bounded(redact({ run: { ...run, logs: logs.rows } }));
}
