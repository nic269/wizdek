import type { PoolClient } from "pg";
import { DEFAULT_SITE_CONFIG } from "../../lib/site-config";
import { invariant } from "../errors";
import type { Connection } from "../profiles/schema";
import { cronWithCatalog } from "./cron-catalog";
import { decryptOmsSecret } from "./oms-secrets";

export async function directCatalog(db: PoolClient, connection: Connection) {
  invariant(
    connection.globalDiagnostics,
    "global_scope_required",
    "Catalog access requires database-wide access.",
    403
  );
  const cron = await cronWithCatalog(db, connection);
  const apps =
    await db.query(`SELECT id,name,"clientId","installLink","availableStoreDomains",scopes,"apiVersion",status,
    COALESCE(length("clientSecretEncrypted")>0,false) AS "hasClientSecret","updatedAt" FROM shopify_app ORDER BY "updatedAt" DESC,id LIMIT 1000`);
  const stores = await db.query(
    `SELECT id,"accountId",name,"shopDomain","updatedAt" FROM shopify_store
    WHERE ($1::boolean OR "accountId"=ANY($2::text[])) ORDER BY name,id LIMIT 1000`,
    [connection.globalDiagnostics, connection.accountIds]
  );
  const settings = await db.query(
    'SELECT key,value,"updatedAt" FROM site_setting WHERE key=ANY($1::text[]) ORDER BY key',
    [Object.keys(DEFAULT_SITE_CONFIG)]
  );
  return {
    jobs: cron.catalog,
    shopify: { apps: apps.rows, settings: settings.rows, stores: stores.rows },
    timeZone: cron.timeZone,
  };
}

export async function directReveal(
  db: PoolClient,
  connection: Connection,
  action: string,
  accountId: string,
  payload: Record<string, unknown>
) {
  invariant(
    connection.globalDiagnostics || connection.accountIds.includes(accountId),
    "account_denied",
    "Account is not in this connection scope.",
    403
  );
  invariant(
    typeof payload.storeId === "string" &&
      payload.storeId.length > 0 &&
      payload.storeId.length <= 128,
    "invalid_id",
    "Store ID is required."
  );
  const stores = await db.query(
    'SELECT id,"webhookSignatureEncrypted" FROM shopify_store WHERE id=$1 AND "accountId"=$2',
    [payload.storeId, accountId]
  );
  const [store] = stores.rows;
  invariant(
    store,
    "store_not_found",
    "Store was not found in the selected account.",
    404
  );
  let encrypted: string | null = null;
  if (action === "shopify.signature.reveal") {
    encrypted = store.webhookSignatureEncrypted;
  } else {
    invariant(
      action === "shopify.token.reveal",
      "unsupported_action",
      "This secret action is not supported."
    );
    const tokens = await db.query(
      'SELECT "accessTokenEncrypted" FROM shopify_token WHERE "storeId"=$1 AND "revokedAt" IS NULL ORDER BY "updatedAt" DESC LIMIT 1',
      [store.id]
    );
    encrypted = tokens.rows[0]?.accessTokenEncrypted ?? null;
  }
  return { secret: encrypted ? decryptOmsSecret(connection, encrypted) : null };
}
