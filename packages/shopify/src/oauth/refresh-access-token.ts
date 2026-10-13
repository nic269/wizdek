import { requestShopifyToken } from "./token-endpoint";
import type {
  ShopifyAppCredentials,
  ShopifyTokenRequestOptions,
  ShopifyTokenResult,
} from "./types";

/**
 * Trades a refresh token for a new access token. Shopify rotates the refresh
 * token on every call, so the caller must persist both returned tokens.
 */
export const refreshAccessToken = (
  input: ShopifyAppCredentials & { refreshToken: string; shop: string },
  options: ShopifyTokenRequestOptions = {}
): Promise<ShopifyTokenResult> =>
  requestShopifyToken({
    ...options,
    grant: "refresh-token",
    params: {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    },
    shop: input.shop,
  });
