import { requestShopifyToken } from "./token-endpoint";
import type {
  ShopifyAppCredentials,
  ShopifyTokenAdapter,
  ShopifyTokenAdapterOptions,
} from "./types";

export const createTokenExchangeAdapter = (
  credentials: ShopifyAppCredentials,
  { expiring, ...options }: ShopifyTokenAdapterOptions = {}
): ShopifyTokenAdapter => ({
  canHandle: (input) => Boolean(input.idToken),
  exchange: (input) => {
    if (!input.idToken) {
      throw new Error("ID token is required for token exchange.");
    }
    return requestShopifyToken({
      ...options,
      grant: "token-exchange",
      params: {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type:
          "urn:shopify:params:oauth:token-type:offline-access-token",
        subject_token: input.idToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        ...(expiring ? { expiring: "1" } : {}),
      },
      shop: input.shop,
    });
  },
  name: "token-exchange",
});
