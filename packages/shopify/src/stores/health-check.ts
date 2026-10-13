import { ShopifyGraphqlError, ShopifyTransportError } from "../admin/errors";
import { ShopifyOAuthError } from "../oauth/token-endpoint";
import { StoreReconnectRequiredError } from "./errors";
import { createStoreClient, type StoreClientOptions } from "./store-client";
import { getStore, type StoreScope, updateStore } from "./store-repository";

const HEALTH_CHECK_TIMEOUT_MS = 15_000;

const HEALTH_CHECK_QUERY = `query StoreHealthCheck {
  shop { name myshopifyDomain currencyCode }
  currentAppInstallation { accessScopes { handle } }
}`;

interface HealthCheckData {
  currentAppInstallation: { accessScopes: { handle: string }[] } | null;
  shop: { currencyCode: string; myshopifyDomain: string; name: string };
}

export type StoreHealthCheckResult =
  | { currencyCode: string; ok: true; scopes: string[]; shopName: string }
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
    const data = await client.requestOrThrow<HealthCheckData>({
      operationName: "StoreHealthCheck",
      query: HEALTH_CHECK_QUERY,
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    });
    const scopes =
      data.currentAppInstallation?.accessScopes.map(({ handle }) => handle) ??
      [];
    await updateStore(scope, {
      connectedAt: client.store.connectedAt ?? checkedAt,
      currencyCode: data.shop.currencyCode,
      lastHealthCheckAt: checkedAt,
      lastHealthCheckError: null,
      name: data.shop.name,
      scopes,
      status: "CONNECTED",
    });
    return {
      currencyCode: data.shop.currencyCode,
      ok: true,
      scopes,
      shopName: data.shop.name,
    };
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
