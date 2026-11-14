import type { PoolClient } from "pg";
import { invariant } from "../errors";
export interface Compatibility {
  checkedAt: string;
  databaseIdentity: string | null;
  features: string[];
}
const required: Record<string, Record<string, string[]>> = {
  accounts: {
    user: ["id", "name", "email"],
    workspace_account: ["id", "name"],
    workspace_account_user: ["accountId", "userId"],
  },
  cron: {
    scheduled_job_config: [
      "jobKey",
      "enabled",
      "cronExpression",
      "lastCheckedAt",
      "lastActivityAt",
      "lastSuccessAt",
      "lastFailureAt",
      "consecutiveFailures",
      "updatedAt",
    ],
    scheduled_job_run: [
      "id",
      "jobKey",
      "status",
      "trigger",
      "startedAt",
      "completedAt",
      "errorMessage",
      "workflowRunId",
      "createdAt",
    ],
  },
  logs: {
    workflow_run: [
      "id",
      "accountId",
      "actorId",
      "module",
      "featureKey",
      "workflowKey",
      "status",
      "title",
      "createdAt",
      "completedAt",
    ],
    workflow_run_log: [
      "id",
      "workflowRunId",
      "sequence",
      "level",
      "stage",
      "event",
      "status",
      "message",
      "rowNumber",
      "shopDomain",
      "errorName",
      "errorCode",
      "errorMessage",
      "createdAt",
    ],
  },
  maintenance: { site_setting: ["key", "value", "updatedAt"] },
};
export async function probe(client: PoolClient): Promise<Compatibility> {
  // Use the supplied database user's actual permissions. Management does not
  // require a special PostgreSQL role or alter that user's grants.
  const grants = await client.query(`SELECT c.relname,a.attname,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS readable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped`);
  const columns = new Map<string, Set<string>>();
  for (const row of grants.rows.filter((r) => r.readable)) {
    const set = columns.get(row.relname) ?? new Set();
    set.add(row.attname);
    columns.set(row.relname, set);
  }
  const features = Object.entries(required)
    .filter(([, tables]) =>
      Object.entries(tables).every(([t, cols]) =>
        cols.every((c) => columns.get(t)?.has(c))
      )
    )
    .map(([feature]) => feature);
  invariant(
    features.length > 0,
    "schema_incompatible",
    "No supported OMS diagnostic features are readable."
  );
  let databaseIdentity: string | null = null;
  if (features.includes("maintenance")) {
    const result = await client.query(
      "SELECT value FROM site_setting WHERE key='management.databaseIdentity'"
    );
    databaseIdentity =
      typeof result.rows[0]?.value === "string" ? result.rows[0].value : null;
  }
  return { checkedAt: new Date().toISOString(), databaseIdentity, features };
}
