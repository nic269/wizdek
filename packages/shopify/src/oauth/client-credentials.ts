import { requestShopifyToken } from "./token-endpoint";
import type {
  ShopifyAppCredentials,
  ShopifyTokenRequestOptions,
  ShopifyTokenResult,
} from "./types";

/**
 * Requests a token with the app's own credentials. Works only when the app
 * and the store belong to the same Shopify organization. The token lasts
 * about 24 hours and cannot be refreshed; request a new one instead.
 */
export const requestClientCredentialsToken = (
  input: ShopifyAppCredentials & { shop: string },
  options: ShopifyTokenRequestOptions = {}
): Promise<ShopifyTokenResult> =>
  requestShopifyToken({
    ...options,
    grant: "client-credentials",
    params: {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "client_credentials",
    },
    shop: input.shop,
  });
