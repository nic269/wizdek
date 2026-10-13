import { adminBaseUrlOverride } from "./keys";

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export class InvalidShopDomainError extends Error {
  constructor() {
    super("Invalid Shopify shop domain.");
    this.name = "InvalidShopDomainError";
  }
}

export const normalizeShopDomain = (shop: string): string => {
  const normalized = shop.trim().toLowerCase();
  if (!SHOP_DOMAIN_PATTERN.test(normalized)) {
    throw new InvalidShopDomainError();
  }
  return normalized;
};

/**
 * The only place an outbound Shopify origin is built. The domain is validated
 * here so no caller can direct a server-side request at another host.
 */
export const shopOrigin = (shopDomain: string): string => {
  const domain = normalizeShopDomain(shopDomain);
  return adminBaseUrlOverride() ?? `https://${domain}`;
};
