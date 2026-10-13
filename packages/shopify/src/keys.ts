import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const DEFAULT_SHOPIFY_API_VERSION = "2026-07";

const API_VERSION_PATTERN = /^\d{4}-\d{2}$/;
const TRAILING_SLASHES = /\/+$/;

/**
 * Redirects every Shopify request to another origin so browser tests can
 * target the fake server. Refused in production: honouring it there would
 * send store tokens to an arbitrary host.
 */
export const adminBaseUrlOverride = (): string | undefined => {
  const override = process.env.SHOPIFY_ADMIN_BASE_URL_OVERRIDE?.trim();
  if (!override) {
    return;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SHOPIFY_ADMIN_BASE_URL_OVERRIDE must not be set in production."
    );
  }
  return override.replace(TRAILING_SLASHES, "");
};

export const defaultApiVersion = (): string => {
  const configured = process.env.SHOPIFY_API_VERSION?.trim();
  return configured && API_VERSION_PATTERN.test(configured)
    ? configured
    : DEFAULT_SHOPIFY_API_VERSION;
};

export const keys = () => {
  adminBaseUrlOverride();
  return createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: process.env,
    server: {
      SHOPIFY_ADMIN_BASE_URL_OVERRIDE: z.string().url().optional(),
      SHOPIFY_API_VERSION: z.string().regex(API_VERSION_PATTERN).optional(),
      SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().min(32),
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  });
};
