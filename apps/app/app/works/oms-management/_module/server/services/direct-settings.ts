import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type { PoolClient } from "pg";
import { invariant } from "../errors";
import { fingerprint } from "../oms-api/client";
import type { Connection } from "../profiles/schema";
import { localCronDefinitions } from "./cron-catalog";
import { encryptOmsSecret } from "./oms-secrets";

export interface SettingsInput {
  accountId?: string | undefined;
  action: string;
  expectedVersion: string | null;
  payload: Record<string, unknown>;
}
export const isDirectSettingsAction = (action: string) =>
  action === "maintenance.update" ||
  action.startsWith("shopify.") ||
  ["cron.start", "cron.stop", "cron.update"].includes(action);
const settingsKeys = [
  "shopifyApiVersion",
  "shopifyRequiredScopes",
  "siteTimezone",
];
const stamp = `date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC')`;
const nextStamp = `GREATEST(${stamp},"updatedAt"+interval '1 millisecond')`;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const check = (
  condition: unknown,
  message: string,
  code = "invalid_settings",
  status = 400
) => invariant(condition, code, message, status);
const version = (actual: unknown, expected: string | null) =>
  check(
    (actual
      ? (actual instanceof Date
          ? actual
          : new Date(String(actual))
        ).toISOString()
      : null) === expected,
    "The record changed. Reload before saving.",
    "version_conflict",
    409
  );
const SEPARATOR = /[\n,]+/;
const API_VERSION = /^\d{4}-\d{2}$/;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SPACE = /\s+/;
function listValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.split(SEPARATOR);
  }
  return [];
}
export function parseScopes(value: unknown) {
  if (!Array.isArray(value) && typeof value !== "string") {
    return ["read_orders", "write_orders", "read_products"];
  }
  return listValues(value)
    .map(String)
    .map((v) => v.trim())
    .filter(Boolean);
}
export function apiVersion(value: unknown) {
  const result = String(value ?? "2026-04").trim();
  check(
    API_VERSION.test(result),
    "Shopify API version must use YYYY-MM format."
  );
  return result;
}
export function timeZone(value: unknown) {
  const result = String(value ?? "").trim() || "Asia/Hong_Kong";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date());
  } catch {
    check(false, "Timezone must be a valid IANA timezone.");
  }
  return result;
}
export function appPayload(
  body: Record<string, unknown>,
  requireSecret: boolean
) {
  const name = String(body.name ?? "").trim();
  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();
  check(
    name && clientId && (!requireSecret || clientSecret),
    "App name, client ID and a secret for new apps are required."
  );
  const installLink = String(body.installLink ?? "").trim();
  try {
    const url = new URL(installLink);
    const redirect = decodeURIComponent(url.searchParams.get("redirect") ?? "");
    const supplied = redirect
      ? new URL(redirect, url.origin).searchParams.get("client_id")
      : url.searchParams.get("client_id");
    check(
      url.origin === "https://admin.shopify.com" && supplied === clientId,
      "Install link must be a Shopify custom app URL for this client ID."
    );
  } catch {
    check(
      false,
      "Install link must be a Shopify custom app URL for this client ID."
    );
  }
  const domains = body.storeDomains ?? body.storeIds;
  const raw = listValues(domains);
  const storeDomains = [
    ...new Set(raw.map((v) => String(v).trim().toLowerCase())),
  ];
  check(
    storeDomains.every((v) => SHOP_DOMAIN.test(v)),
    "Invalid Shopify shop domain."
  );
  return {
    apiVersion: apiVersion(body.apiVersion),
    clientId,
    clientSecret,
    installLink,
    name,
    scopes: parseScopes(body.scopes),
    status: body.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    storeDomains,
  };
}
export async function previewDirectSettings(
  db: PoolClient,
  input: SettingsInput
) {
  const p = input.payload;
  if (input.action === "shopify.settings.update") {
    return plain(
      (
        await db.query(
          'SELECT key,value,"updatedAt" FROM site_setting WHERE key=ANY($1::text[]) ORDER BY key',
          [settingsKeys]
        )
      ).rows
    );
  }
  if (input.action === "shopify.app.create") {
    return null;
  }
  if (input.action.startsWith("shopify.app.")) {
    const [row] = (
      await db.query("SELECT * FROM shopify_app WHERE id=$1", [String(p.appId)])
    ).rows;
    check(row, "Shopify app was not found.", "app_not_found", 404);
    return plain(row);
  }
  if (input.action === "shopify.signature.update") {
    check(
      input.accountId && typeof p.storeId === "string",
      "A store and account are required."
    );
    const [row] = (
      await db.query(
        'SELECT id,"webhookSignatureEncrypted","updatedAt" FROM shopify_store WHERE id=$1 AND "accountId"=$2',
        [p.storeId, input.accountId]
      )
    ).rows;
    check(row, "Store was not found in this account.", "store_not_found", 404);
    return plain(row);
  }
  if (input.action.startsWith("cron.")) {
    return plain(
      (
        await db.query(
          'SELECT "jobKey",enabled,"cronExpression","updatedAt" FROM scheduled_job_config WHERE "jobKey"=$1',
          [String(p.jobKey)]
        )
      ).rows[0] ?? null
    );
  }
  check(false, "Unsupported direct settings action.");
}
export function directVersion(action: string, before: unknown): string | null {
  return action === "shopify.settings.update"
    ? fingerprint(before)
    : ((before as { updatedAt?: string } | null)?.updatedAt ?? null);
}
export function executeDirectSettings(
  db: PoolClient,
  connection: Connection,
  input: SettingsInput
) {
  if (input.action === "shopify.settings.update") {
    return updateGeneralSettings(db, input);
  }
  if (input.action === "shopify.signature.update") {
    return updateSignature(db, connection, input);
  }
  if (input.action.startsWith("shopify.app.")) {
    return updateApp(db, connection, input);
  }
  return updateCron(db, input);
}
async function updateGeneralSettings(db: PoolClient, input: SettingsInput) {
  const p = input.payload;

  await db.query("LOCK TABLE site_setting IN SHARE ROW EXCLUSIVE MODE");
  const before = await previewDirectSettings(db, input);
  check(
    fingerprint(before) === input.expectedVersion,
    "Settings changed. Reload before saving.",
    "version_conflict",
    409
  );
  const updates: [string, string][] = [
    ["shopifyApiVersion", apiVersion(p.shopifyApiVersion)],
    ["shopifyRequiredScopes", parseScopes(p.shopifyRequiredScopes).join(",")],
  ];
  if (p.siteTimezone !== undefined) {
    updates.push(["siteTimezone", timeZone(p.siteTimezone)]);
  }
  for (const [key, value] of updates) {
    await db.query(
      `INSERT INTO site_setting(key,value,"createdAt","updatedAt") VALUES($1,$2,${stamp},${stamp}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=GREATEST(${stamp},site_setting."updatedAt"+interval '1 millisecond')`,
      [key, value]
    );
  }
  return Object.fromEntries(updates);
}
async function updateSignature(
  db: PoolClient,
  connection: Connection,
  input: SettingsInput
) {
  const p = input.payload;

  check(
    input.accountId &&
      typeof p.storeId === "string" &&
      typeof p.signature === "string" &&
      p.signature.length <= 4096,
    "A valid account, store and signature are required."
  );
  const [row] = (
    await db.query(
      'SELECT id,"updatedAt" FROM shopify_store WHERE id=$1 AND "accountId"=$2 FOR UPDATE',
      [p.storeId, input.accountId]
    )
  ).rows;
  check(row, "Store was not found in this account.", "store_not_found", 404);
  version(row.updatedAt, input.expectedVersion);
  const encrypted = p.signature
    ? encryptOmsSecret(connection, p.signature as string)
    : null;
  await db.query(
    `UPDATE shopify_store SET "webhookSignatureEncrypted"=$2,"updatedAt"=${nextStamp} WHERE id=$1`,
    [row.id, encrypted]
  );
  return { hasWebhookSignature: !!p.signature, storeId: row.id };
}
async function updateApp(
  db: PoolClient,
  connection: Connection,
  input: SettingsInput
) {
  const p = input.payload;

  await db.query("LOCK TABLE shopify_app IN SHARE ROW EXCLUSIVE MODE");
  const existing =
    input.action === "shopify.app.create"
      ? null
      : ((await previewDirectSettings(db, input)) as Record<string, unknown>);
  if (existing) {
    version(existing.updatedAt, input.expectedVersion);
  } else {
    version(null, input.expectedVersion);
  }
  if (input.action === "shopify.app.delete") {
    check(
      p.clientId === existing?.clientId,
      "Client ID confirmation does not match."
    );
    await db.query("DELETE FROM shopify_app WHERE id=$1", [existing?.id]);
    return { appId: existing?.id, deleted: true };
  }
  const payload = appPayload(
    { ...p, clientId: p.clientId ?? existing?.clientId },
    !existing
  );
  const conflict = await db.query(
    'SELECT id FROM shopify_app WHERE "availableStoreDomains" && $1::text[] AND ($2::text IS NULL OR id<>$2) LIMIT 1',
    [payload.storeDomains, existing?.id ?? null]
  );
  check(
    !conflict.rows.length,
    "One or more stores are assigned to another Shopify app."
  );
  const id = existing?.id ?? randomUUID();
  const secret = payload.clientSecret
    ? encryptOmsSecret(connection, payload.clientSecret)
    : (existing?.clientSecretEncrypted ?? null);
  const values = [
    id,
    payload.name,
    payload.clientId,
    secret,
    payload.installLink,
    payload.storeDomains,
    payload.scopes,
    payload.apiVersion,
    payload.status,
  ];
  const query = existing
    ? `UPDATE shopify_app SET name=$2,"clientId"=$3,"clientSecretEncrypted"=$4,"installLink"=$5,"availableStoreDomains"=$6,scopes=$7,"apiVersion"=$8,status=$9,"updatedAt"=${nextStamp} WHERE id=$1 RETURNING *`
    : `INSERT INTO shopify_app(id,name,"clientId","clientSecretEncrypted","installLink","availableStoreDomains",scopes,"apiVersion",status,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,${stamp},${stamp}) RETURNING *`;
  const [app] = (await db.query(query, values)).rows;
  const { clientSecretEncrypted, ...safe } = app;
  return { app: { ...safe, hasClientSecret: !!clientSecretEncrypted } };
}
async function updateCron(db: PoolClient, input: SettingsInput) {
  const p = input.payload;
  check(
    ["cron.start", "cron.stop", "cron.update"].includes(input.action),
    "Unsupported direct settings action."
  );
  const definition = localCronDefinitions.find((job) => job.key === p.jobKey);
  check(
    definition,
    "This scheduled job is not in the OMS job catalog.",
    "job_not_found",
    404
  );
  await db.query("LOCK TABLE scheduled_job_config IN SHARE ROW EXCLUSIVE MODE");
  const current = (await previewDirectSettings(db, input)) as Record<
    string,
    unknown
  > | null;
  version(current?.updatedAt, input.expectedVersion);
  let enabled =
    current?.enabled === undefined ? true : Boolean(current.enabled);
  let expression = String(
    current?.cronExpression ?? definition?.defaultCronExpression
  );
  if (input.action === "cron.start") {
    enabled = true;
  } else if (input.action === "cron.stop") {
    enabled = false;
  } else {
    check(
      typeof p.cronExpression === "string" && typeof p.enabled === "boolean",
      "Invalid scheduled job settings."
    );
    expression = String(p.cronExpression).trim();
    enabled = Boolean(p.enabled);
    check(
      expression.split(SPACE).length === 5,
      "Cron expression must have five fields."
    );
    const zone = (
      await db.query("SELECT value FROM site_setting WHERE key='siteTimezone'")
    ).rows[0]?.value;
    try {
      new Cron(expression, { paused: true, timezone: timeZone(zone) }).stop();
    } catch {
      check(false, "Invalid cron expression.");
    }
  }
  const result = await db.query(
    `INSERT INTO scheduled_job_config("jobKey",enabled,"cronExpression","createdAt","updatedAt") VALUES($1,$2,$3,${stamp},${stamp}) ON CONFLICT("jobKey") DO UPDATE SET enabled=EXCLUDED.enabled,"cronExpression"=EXCLUDED."cronExpression","updatedAt"=GREATEST(${stamp},scheduled_job_config."updatedAt"+interval '1 millisecond') RETURNING *`,
    [p.jobKey, enabled, expression]
  );
  return { config: result.rows[0] };
}
