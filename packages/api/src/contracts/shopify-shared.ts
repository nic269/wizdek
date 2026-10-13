import { z } from "zod";

/**
 * Mirrors the server-side check in `@repo/shopify`, which stays the
 * authority. Repeated here because contracts are also bundled for the
 * browser and must not import a server-only package.
 */
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const shopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SHOP_DOMAIN_PATTERN, "Enter a domain like your-store.myshopify.com.");

export const organizationIdInput = z.object({
  organizationId: z.string().min(1),
});

export const storeIdInput = z.object({ storeId: z.string().min(1) });
