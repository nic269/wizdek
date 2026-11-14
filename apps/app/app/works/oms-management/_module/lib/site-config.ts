export const DEFAULT_SITE_CONFIG = {
  shopifyApiVersion: "2026-04",
  shopifyRequiredScopes:
    "read_orders,write_orders,read_products,read_fulfillments,write_fulfillments",
  siteTimezone: "Asia/Hong_Kong",
};

export interface ShopifyAppConfig {
  apiVersion: string;
  availableStoreDomains: string[];
  clientId: string;
  hasClientSecret: boolean;
  id: string;
  installLink: string;
  name: string;
  scopes: string[];
  status: "ACTIVE" | "DISABLED";
  updatedAt: string;
}

export interface SiteConfigData {
  apps: ShopifyAppConfig[];
  appsAvailable: boolean;
  cron: {
    configs: Record<string, unknown>[];
    runs: Record<string, unknown>[];
    catalog?: Record<string, unknown>[];
    timeZone?: string;
    note: string;
  } | null;
  maintenance: {
    value: { enabled: boolean; exceptions: string[] };
    version: string | null;
  } | null;
  settings: typeof DEFAULT_SITE_CONFIG;
  settingsVersion: string;
}

export function mergeCronJobs(
  data: NonNullable<SiteConfigData["cron"]>
): Record<string, unknown>[] {
  const definitions = data.catalog ?? [];
  const known = new Set(definitions.map((job) => job.key));
  return [
    ...definitions.map((job) => ({
      ...job,
      ...data.configs.find((config) => config.jobKey === job.key),
    })),
    ...data.configs.filter((job) => !known.has(job.jobKey)),
  ].map((job) => ({
    ...job,
    lastRun:
      data.runs.find((run) => run.jobKey === (job.jobKey ?? job.key)) ?? null,
  }));
}

export function formatSiteDate(value: unknown, timeZone: string) {
  if (!value) {
    return "Never";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
