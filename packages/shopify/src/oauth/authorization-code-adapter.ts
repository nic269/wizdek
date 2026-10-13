import { requestShopifyToken } from "./token-endpoint";
import type {
  ShopifyAppCredentials,
  ShopifyTokenAdapter,
  ShopifyTokenAdapterOptions,
} from "./types";

export const createAuthorizationCodeAdapter = (
  credentials: ShopifyAppCredentials,
  { expiring, ...options }: ShopifyTokenAdapterOptions = {}
): ShopifyTokenAdapter => ({
  canHandle: (input) => Boolean(input.code),
  exchange: (input) => {
    if (!input.code) {
      throw new Error("Authorization code is required.");
    }
    return requestShopifyToken({
      ...options,
      encoding: "json",
      grant: "authorization-code",
      params: {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code: input.code,
        ...(expiring ? { expiring: "1" } : {}),
      },
      shop: input.shop,
    });
  },
  name: "authorization-code",
});
