import { keys } from "@repo/auth/keys";
import { InvalidShopDomainError, normalizeShopDomain } from "@repo/shopify";
import type { Context } from "hono";
import { ApiError } from "./errors";

/** The redirect URL registered in the Shopify app configuration. */
export const SHOPIFY_OAUTH_CALLBACK_PATH = "/api/shopify/oauth/callback";

const APP_CALLBACK_PATH = "/stores/oauth/callback";

/**
 * Hands Shopify's callback to the app, where a signed-in user completes it.
 * Changes no state and redirects only to the configured app URL, so the
 * callback cannot be used as an open redirect.
 */
export const handleShopifyOAuthCallback = (context: Context) => {
  const url = new URL(context.req.url);
  try {
    normalizeShopDomain(url.searchParams.get("shop") ?? "");
  } catch (error) {
    if (error instanceof InvalidShopDomainError) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "The callback does not name a valid Shopify store.",
        422
      );
    }
    throw error;
  }
  const target = new URL(APP_CALLBACK_PATH, keys().NEXT_PUBLIC_APP_URL);
  target.search = url.search;
  return context.redirect(target.toString(), 302);
};
