import { executeAdminGraphqlOrThrow } from "../admin/admin-client";
import { ShopifyGraphqlError, ShopifyTransportError } from "../admin/errors";
import { ShopifyOAuthError } from "../oauth/token-endpoint";
import { StoreReconnectRequiredError } from "./errors";
import { createStoreClient, type StoreClientOptions } from "./store-client";
import { getStore, type StoreScope, updateStore } from "./store-repository";

export const HEALTH_CHECK_TIMEOUT_MS = 15_000;

export const HEALTH_CHECK_OPERATION = "StoreHealthCheck";

export const HEALTH_CHECK_QUERY = `query StoreHealthCheck {
  shop { name myshopifyDomain currencyCode }
  currentAppInstallation { accessScopes { handle } }
}`;

export interface HealthCheckData {
  currentAppInstallation: { accessScopes: { handle: string }[] } | null;
  shop: { currencyCode: string; myshopifyDomain: string; name: string };
}

export interface ShopDetails {
  currencyCode: string;
  scopes: string[];
  shopName: string;
}

export const toShopDetails = (data: HealthCheckData): ShopDetails => ({
  currencyCode: data.shop.currencyCode,
  scopes:
    data.currentAppInstallation?.accessScopes.map(({ handle }) => handle) ?? [],
  shopName: data.shop.name,
});

/**
 * Runs the health query with a token that is not stored yet, so credentials
 * can be verified before a store is saved.
 */
export const probeShop = async (request: {
  accessToken: string;
  apiVersion?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  shopDomain: string;
}): Promise<ShopDetails> =>
  toShopDetails(
    await executeAdminGraphqlOrThrow<HealthCheckData>({
      ...request,
      operationName: HEALTH_CHECK_OPERATION,
      query: HEALTH_CHECK_QUERY,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    })
  );

export type StoreHealthCheckResult =
  | (ShopDetails & { ok: true })
  | { error: string; ok: false };

const isExpectedFailure = (error: unknown): error is Error =>
  error instanceof ShopifyGraphqlError ||
  error instanceof ShopifyTransportError ||
  error instanceof ShopifyOAuthError ||
  error instanceof StoreReconnectRequiredError;

/**
 * Calls the store with its current credentials and records the outcome. A
 * success marks the store connected and refreshes its name, currency and
 * granted scopes; a failure records the reason and leaves the status to the
 * credential checks that already ran.
 */
export const runStoreHealthCheck = async (
  scope: StoreScope,
  options: StoreClientOptions = {}
): Promise<StoreHealthCheckResult> => {
  const checkedAt = new Date();
  try {
    const client = await createStoreClient(scope, options);
    const details = toShopDetails(
      await client.requestOrThrow<HealthCheckData>({
        operationName: HEALTH_CHECK_OPERATION,
        query: HEALTH_CHECK_QUERY,
        timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      })
    );
    await updateStore(scope, {
      connectedAt: client.store.connectedAt ?? checkedAt,
      currencyCode: details.currencyCode,
      lastHealthCheckAt: checkedAt,
      lastHealthCheckError: null,
      name: details.shopName,
      scopes: details.scopes,
      status: "CONNECTED",
    });
    return { ...details, ok: true };
  } catch (error) {
    if (!isExpectedFailure(error)) {
      throw error;
    }
    // Confirms the store still exists before recording against it.
    await getStore(scope);
    await updateStore(scope, {
      lastHealthCheckAt: checkedAt,
      lastHealthCheckError: error.message,
    });
    return { error: error.message, ok: false };
  }
};
