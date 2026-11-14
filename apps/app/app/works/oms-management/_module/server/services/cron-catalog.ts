import { Cron } from "croner";
import type { PoolClient } from "pg";
import { DEFAULT_SITE_CONFIG } from "../../lib/site-config";
import type { Config } from "../config";
import type { Connection } from "../profiles/schema";
import { cronStatus } from "./diagnostics";

// OMS registry metadata only; execution stays in the OMS scheduler.
export const localCronDefinitions = [
  {
    defaultCronExpression: "0 1 * * *",
    description:
      "Updates sales-rank and bestseller product metafields for every connected Shopify store.",
    key: "sales-data.update",
    module: "REPORTS",
    title: "Sales data update",
  },
  {
    defaultCronExpression: "0 1 * * *",
    description:
      "Reconcile pre-order products, generate CSV files, and upload them to private object storage.",
    key: "preorder-products.export",
    module: "IMPORT_EXPORT",
    title: "Pre-order products export",
  },
  {
    defaultCronExpression: "0 * * * *",
    description:
      "Recover pending pre-order events without managing manual Shopify Admin webhook subscriptions.",
    key: "preorder-products.webhook-health",
    module: "SETTINGS",
    title: "Pre-order webhook recovery",
  },
  {
    defaultCronExpression: "*/5 * * * *",
    description:
      "Claims due US in-transit notifications, sends email, and tags the Shopify order.",
    key: "notifications.us-in-transit-dispatch",
    module: "NOTIFICATIONS",
    title: "US in-transit notification dispatch",
  },
  {
    defaultCronExpression: "*/5 * * * *",
    description:
      "Claims due Order Dispatch notifications and sends the configured customer email.",
    key: "notifications.order-dispatch",
    module: "NOTIFICATIONS",
    title: "Order Dispatch notification dispatch",
  },
];

export function cronCatalog(
  configs: Record<string, unknown>[],
  timeZone: string,
  now = new Date()
) {
  return localCronDefinitions.map((job) => {
    const config = configs.find((row) => row.jobKey === job.key);
    const enabled = config?.enabled !== false;
    const cronExpression = String(
      config?.cronExpression ?? job.defaultCronExpression
    );
    let nextRunAt: string | null = null;
    if (enabled) {
      try {
        nextRunAt =
          new Cron(cronExpression, { paused: true, timezone: timeZone })
            .nextRun(now)
            ?.toISOString() ?? null;
      } catch {
        /* Invalid stored expressions stay visible for correction. */
      }
    }
    return { ...job, cronExpression, enabled, nextRunAt };
  });
}

export async function cronWithCatalog(
  db: PoolClient,
  connection: Connection,
  _config?: Config
) {
  const state = (await cronStatus(db, connection)) as {
    configs: Record<string, unknown>[];
    runs: Record<string, unknown>[];
  };
  const timezone = await db.query(
    "SELECT value FROM site_setting WHERE key='siteTimezone'"
  );
  const timeZone = timezone.rows[0]?.value || DEFAULT_SITE_CONFIG.siteTimezone;
  return {
    ...state,
    catalog: cronCatalog(state.configs, timeZone),
    note: "Configuration from the selected database. Next run is calculated from its stored schedule; OMS executes jobs.",
    timeZone,
  };
}
