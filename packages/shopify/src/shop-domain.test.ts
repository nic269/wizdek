import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeShopDomain, shopOrigin } from "./shop-domain";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeShopDomain", () => {
  it("normalizes valid myshopify domains", () => {
    expect(normalizeShopDomain("  Example-Store.myshopify.com ")).toBe(
      "example-store.myshopify.com"
    );
  });

  it.each([
    "evil.com",
    "a.myshopify.com.evil.com",
    "evil.com/a.myshopify.com",
    "a.myshopify.com@evil.com",
    "https://a.myshopify.com",
    "-a.myshopify.com",
    "a.b.myshopify.com",
    "a.myshopify.com:8080",
    ".myshopify.com",
    "",
  ])("rejects %j", (domain) => {
    expect(() => normalizeShopDomain(domain)).toThrow(
      "Invalid Shopify shop domain."
    );
  });
});

describe("shopOrigin", () => {
  it("builds the origin from the validated domain", () => {
    vi.stubEnv("SHOPIFY_ADMIN_BASE_URL_OVERRIDE", "");
    expect(shopOrigin("Example.myshopify.com")).toBe(
      "https://example.myshopify.com"
    );
  });

  it("validates the domain even when an override is active", () => {
    vi.stubEnv("SHOPIFY_ADMIN_BASE_URL_OVERRIDE", "http://127.0.0.1:9/");
    expect(shopOrigin("example.myshopify.com")).toBe("http://127.0.0.1:9");
    expect(() => shopOrigin("evil.com")).toThrow();
  });
});
