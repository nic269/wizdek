import { createAuthorizationCodeAdapter } from "./authorization-code-adapter";
import { createTokenExchangeAdapter } from "./token-exchange-adapter";
import type {
  ShopifyAppCredentials,
  ShopifyOAuthCallbackInput,
  ShopifyTokenAdapter,
  ShopifyTokenAdapterOptions,
  ShopifyTokenResult,
} from "./types";

export const createShopifyTokenService = (
  credentials: ShopifyAppCredentials,
  options: ShopifyTokenAdapterOptions = {},
  adapters: ShopifyTokenAdapter[] = [
    createTokenExchangeAdapter(credentials, options),
    createAuthorizationCodeAdapter(credentials, options),
  ]
) => ({
  exchange: (input: ShopifyOAuthCallbackInput): Promise<ShopifyTokenResult> => {
    const adapter = adapters.find((candidate) => candidate.canHandle(input));
    if (!adapter) {
      throw new Error(
        "No Shopify token adapter can handle this OAuth callback."
      );
    }
    return adapter.exchange(input);
  },
});
