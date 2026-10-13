import {
  type AdminGraphqlRequest,
  type AdminGraphqlResult,
  executeAdminGraphql,
  unwrapAdminGraphqlData,
} from "../admin/admin-client";
import { resolveAccessToken } from "./access-token-resolver";
import {
  getStore,
  markStoreReconnectRequired,
  type ShopifyStoreWithApp,
  type StoreScope,
} from "./store-repository";

export type StoreGraphqlRequest = Pick<
  AdminGraphqlRequest,
  "costDebug" | "operationName" | "query" | "timeoutMs" | "variables"
>;

export interface StoreClientOptions {
  fetchImpl?: typeof fetch | undefined;
}

export interface StoreClient {
  /** Returns Shopify's answer untouched, including GraphQL errors. */
  request(request: StoreGraphqlRequest): Promise<AdminGraphqlResult>;
  /** Returns `data`, throwing `ShopifyGraphqlError` on any reported error. */
  requestOrThrow<TData = unknown>(request: StoreGraphqlRequest): Promise<TData>;
  store: Omit<ShopifyStoreWithApp, "app">;
}

const UNAUTHORIZED_REASON =
  "Shopify rejected the access token (HTTP 401). Reconnect the store.";

/**
 * Binds the Admin client to one store of one organization. A store id from
 * another organization fails with `StoreNotFoundError` before any request.
 */
export const createStoreClient = async (
  scope: StoreScope,
  options: StoreClientOptions = {}
): Promise<StoreClient> => {
  const { app: _app, ...store } = await getStore(scope);

  const request = async (
    graphqlRequest: StoreGraphqlRequest
  ): Promise<AdminGraphqlResult> => {
    const accessToken = await resolveAccessToken(scope, options);
    const result = await executeAdminGraphql({
      ...graphqlRequest,
      accessToken,
      apiVersion: store.apiVersion,
      fetchImpl: options.fetchImpl,
      shopDomain: store.shopDomain,
    });
    if (result.httpStatus === 401) {
      await markStoreReconnectRequired(scope, UNAUTHORIZED_REASON);
    }
    return result;
  };

  return {
    request,
    requestOrThrow: async <TData = unknown>(
      graphqlRequest: StoreGraphqlRequest
    ) =>
      unwrapAdminGraphqlData<TData>(
        await request(graphqlRequest),
        graphqlRequest.operationName
      ),
    store,
  };
};
