import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashOAuthState,
  safeEqual,
  verifyAndDecodeShopifySessionToken,
  verifyShopifyOAuthHmac,
} from "./oauth-validation";

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const createSessionToken = (
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }
): string => {
  const signed = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac("sha256", secret)
    .update(signed)
    .digest("base64url");
  return `${signed}.${signature}`;
};

const validPayload = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: "client-id",
    dest: "https://example-store.myshopify.com",
    exp: now + 60,
    iat: now,
    iss: "https://example-store.myshopify.com/admin",
    jti: "test-jti",
    nbf: now - 60,
    sub: "123",
  };
};

const signedQuery = (secret: string): URLSearchParams => {
  const query = new URLSearchParams({
    code: "abc",
    shop: "example.myshopify.com",
    state: "state",
    timestamp: "1",
  });
  const message = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  query.set("hmac", createHmac("sha256", secret).update(message).digest("hex"));
  return query;
};

describe("OAuth callback HMAC", () => {
  it("accepts a correctly signed query", () => {
    expect(verifyShopifyOAuthHmac(signedQuery("secret"), "secret")).toBe(true);
  });

  it("rejects a wrong secret, a changed parameter and a missing hmac", () => {
    expect(verifyShopifyOAuthHmac(signedQuery("secret"), "other")).toBe(false);

    const changed = signedQuery("secret");
    changed.set("shop", "attacker.myshopify.com");
    expect(verifyShopifyOAuthHmac(changed, "secret")).toBe(false);

    const unsigned = signedQuery("secret");
    unsigned.delete("hmac");
    expect(verifyShopifyOAuthHmac(unsigned, "secret")).toBe(false);
  });
});

describe("OAuth state helpers", () => {
  it("hashes state deterministically and compares in constant time", () => {
    expect(hashOAuthState("state")).toBe(hashOAuthState("state"));
    expect(hashOAuthState("state")).not.toBe("state");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("session token validation", () => {
  it("verifies and decodes a valid token", () => {
    const payload = verifyAndDecodeShopifySessionToken(
      createSessionToken(validPayload(), "secret"),
      "client-id",
      "secret",
      "example-store.myshopify.com"
    );

    expect(payload.dest).toBe("https://example-store.myshopify.com");
    expect(payload.sub).toBe("123");
  });

  it("rejects a bad signature, audience, expiry, shop and issuer", () => {
    const verify = (
      overrides: Record<string, unknown>,
      options: { expectedShop?: string; secret?: string } = {}
    ) =>
      verifyAndDecodeShopifySessionToken(
        createSessionToken(
          { ...validPayload(), ...overrides },
          options.secret ?? "secret"
        ),
        "client-id",
        "secret",
        options.expectedShop
      );

    expect(() => verify({}, { secret: "forged" })).toThrow("signature");
    expect(() => verify({ aud: "other-client" })).toThrow("audience");
    expect(() => verify({ exp: 1 })).toThrow("Expired");
    expect(() =>
      verify({}, { expectedShop: "other-store.myshopify.com" })
    ).toThrow("shop mismatch");
    expect(() => verify({ dest: "https://evil.com" })).toThrow("destination");
    expect(() =>
      verify({ iss: "https://other-store.myshopify.com/admin" })
    ).toThrow("issuer mismatch");
  });

  it("rejects unsigned and malformed tokens", () => {
    expect(() =>
      verifyAndDecodeShopifySessionToken(
        createSessionToken(validPayload(), "secret", { alg: "none" }),
        "client-id",
        "secret"
      )
    ).toThrow("algorithm");
    expect(() =>
      verifyAndDecodeShopifySessionToken("only.two", "client-id", "secret")
    ).toThrow("Malformed");
  });
});
