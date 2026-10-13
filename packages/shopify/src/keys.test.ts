import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminBaseUrlOverride,
  DEFAULT_SHOPIFY_API_VERSION,
  defaultApiVersion,
  keys,
} from "./keys";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Shopify env contract", () => {
  it("requires an encryption key of at least 32 characters", () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY", "too-short");
    expect(() => keys()).toThrow();

    vi.stubEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY", "k".repeat(32));
    expect(keys().SHOPIFY_TOKEN_ENCRYPTION_KEY).toHaveLength(32);
  });

  it("refuses the base URL override in production", () => {
    vi.stubEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY", "k".repeat(32));
    vi.stubEnv("SHOPIFY_ADMIN_BASE_URL_OVERRIDE", "http://127.0.0.1:4000");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => adminBaseUrlOverride()).toThrow(
      "must not be set in production"
    );
    expect(() => keys()).toThrow("must not be set in production");
  });

  it("falls back to the package API version", () => {
    vi.stubEnv("SHOPIFY_API_VERSION", "");
    expect(defaultApiVersion()).toBe(DEFAULT_SHOPIFY_API_VERSION);
    vi.stubEnv("SHOPIFY_API_VERSION", "2026-01");
    expect(defaultApiVersion()).toBe("2026-01");
  });
});
