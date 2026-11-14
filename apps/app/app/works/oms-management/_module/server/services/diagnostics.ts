import type { PoolClient } from "pg";
import { invariant } from "../errors";
import type { Connection } from "../profiles/schema";
import { redact } from "../redact";
import { probe } from "../target/compatibility";
export async function accountOptions(db: PoolClient, connection: Connection) {
  const result = await db.query(
    `SELECT a.id,a.name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',member.name,'email',member.email)) FROM (
      SELECT u.name,u.email FROM workspace_account_user m JOIN "user" u ON u.id=m."userId"
      WHERE m."accountId"=a.id ORDER BY u.name,u.id LIMIT 5
    ) member),'[]'::jsonb) AS users
    FROM workspace_account a WHERE ($1::boolean OR a.id=ANY($2::text[]))
    ORDER BY a.name,a.id LIMIT 1000`,
    [connection.globalDiagnostics, connection.accountIds]
  );
  return { rows: result.rows };
}
export {
  filterSchema,
  workflowBundle,
  workflowDetail,
  workflowOptions,
  workflowRuns,
} from "./workflow-logs";

import { workflowRuns } from "./workflow-logs";
export async function overview(db: PoolClient, connection: Connection) {
  const compatibility = await probe(db);
  const failures = compatibility.features.includes("logs")
    ? await workflowRuns(db, connection, { limit: 5, status: "FAILED" })
    : null;
  return {
    api: connection.api ? "configured-unverified" : "not-configured",
    compatibility,
    database: "healthy",
    failures,
    refreshedAt: new Date().toISOString(),
  };
}
export async function cronStatus(db: PoolClient, connection: Connection) {
  invariant(
    connection.globalDiagnostics,
    "global_scope_required",
    "Cron diagnostics require explicit global scope.",
    403
  );
  const configs = await db.query(
    'SELECT "jobKey",enabled,"cronExpression","lastCheckedAt","lastActivityAt","lastSuccessAt","lastFailureAt","consecutiveFailures","updatedAt" FROM scheduled_job_config ORDER BY "jobKey" LIMIT 200'
  );
  const runs = await db.query(
    'SELECT id,"jobKey",status,trigger,"startedAt","completedAt",left("errorMessage",2000) AS "errorMessage","workflowRunId" FROM scheduled_job_run ORDER BY "createdAt" DESC LIMIT 100'
  );
  return redact({
    configs: configs.rows,
    note: "Stored state only. Definitions and controls require a verified OMS bridge.",
    runs: runs.rows,
  });
}
export async function maintenance(db: PoolClient, connection: Connection) {
  invariant(
    connection.globalDiagnostics,
    "global_scope_required",
    "Site settings require explicit global scope.",
    403
  );
  const row = await db.query(
    'SELECT value,"updatedAt" AT TIME ZONE \'UTC\' AS "updatedAt" FROM site_setting WHERE key=$1',
    ["maintenanceMode"]
  );
  return {
    value: row.rows[0]
      ? JSON.parse(row.rows[0].value)
      : { enabled: false, exceptions: [] },
    version: row.rows[0]?.updatedAt ?? null,
  };
}
