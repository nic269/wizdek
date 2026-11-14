import type { PoolClient } from "pg";
import {
  DEFAULT_SITE_CONFIG,
  type SiteConfigData,
} from "../../lib/site-config";
import type { Config } from "../config";
import { invariant } from "../errors";
import { fingerprint } from "../oms-api/client";
import type { Connection } from "../profiles/schema";
import { redact } from "../redact";
import { probe } from "../target/compatibility";
import { cronWithCatalog } from "./cron-catalog";
import { maintenance } from "./diagnostics";

export async function siteConfig(
  db: PoolClient,
  connection: Connection,
  config: Config
): Promise<SiteConfigData> {
  invariant(
    connection.globalDiagnostics,
    "global_scope_required",
    "Site config requires database-wide access.",
    403
  );
  const compatibility = await probe(db);
  const settings = { ...DEFAULT_SITE_CONFIG };
  let maintenanceData: SiteConfigData["maintenance"] = null;
  let settingsVersion = fingerprint([]);
  if (compatibility.features.includes("maintenance")) {
    const rows = await db.query(
      'SELECT key,value,"updatedAt" FROM site_setting WHERE key=ANY($1::text[]) ORDER BY key',
      [Object.keys(settings)]
    );
    settingsVersion = fingerprint(JSON.parse(JSON.stringify(rows.rows)));
    for (const row of rows.rows) {
      if (row.key in settings && typeof row.value === "string") {
        settings[row.key as keyof typeof settings] = row.value;
      }
    }
    maintenanceData = await maintenance(db, connection);
  }
  const columns = [
    "id",
    "name",
    "clientId",
    "installLink",
    "availableStoreDomains",
    "scopes",
    "apiVersion",
    "status",
    "clientSecretEncrypted",
    "updatedAt",
  ];
  const grants = await db.query(
    `SELECT a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname='shopify_app' AND a.attname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT')`,
    [columns]
  );
  const readable = new Set(grants.rows.map((row) => row.attname));
  const appsAvailable = columns.every((column) => readable.has(column));
  const apps = appsAvailable
    ? (
        await db.query(`SELECT id,name,"clientId","installLink","availableStoreDomains",scopes,"apiVersion",status,
    COALESCE(length("clientSecretEncrypted")>0,false) AS "hasClientSecret","updatedAt" FROM shopify_app ORDER BY "updatedAt" DESC,id LIMIT 1000`)
      ).rows
    : [];
  const cron = compatibility.features.includes("cron")
    ? ((await cronWithCatalog(db, connection, config)) as NonNullable<
        SiteConfigData["cron"]
      >)
    : null;
  if (cron) {
    cron.runs = redact(
      (
        await db.query(
          `SELECT DISTINCT ON ("jobKey") id,"jobKey",status,trigger,"startedAt","completedAt",left("errorMessage",2000) AS "errorMessage","workflowRunId" FROM scheduled_job_run ORDER BY "jobKey","createdAt" DESC,id DESC LIMIT 1000`
        )
      ).rows
    ) as Record<string, unknown>[];
  }
  return {
    apps,
    appsAvailable,
    cron: cron ? { ...cron, timeZone: settings.siteTimezone } : null,
    maintenance: maintenanceData,
    settings,
    settingsVersion,
  };
}
