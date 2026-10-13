import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  matchesWebhookTopic,
  verifyShopifyWebhookHmac,
} from "./verify-shopify-webhook";

const SECRET = "webhook-signing-secret";
const body = new TextEncoder().encode('{"id":1,"name":"#1001","note":"café"}');
const sign = (payload: Uint8Array, secret = SECRET) =>
  createHmac("sha256", secret).update(payload).digest("base64");

describe("verifyShopifyWebhookHmac", () => {
  it("accepts the base64 signature of the raw body", () => {
    expect(
      verifyShopifyWebhookHmac({
        hmacHeader: sign(body),
        rawBody: body,
        secret: SECRET,
      })
    ).toBe(true);
  });

  it("rejects a changed body, another secret, a hex digest and a missing header", () => {
    const tampered = new TextEncoder().encode(
      '{"id":2,"name":"#1001","note":"café"}'
    );
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");

    expect(
      verifyShopifyWebhookHmac({
        hmacHeader: sign(body),
        rawBody: tampered,
        secret: SECRET,
      })
    ).toBe(false);
    expect(
      verifyShopifyWebhookHmac({
        hmacHeader: sign(body, "other"),
        rawBody: body,
        secret: SECRET,
      })
    ).toBe(false);
    expect(
      verifyShopifyWebhookHmac({
        hmacHeader: hex,
        rawBody: body,
        secret: SECRET,
      })
    ).toBe(false);
    for (const hmacHeader of [undefined, null, ""]) {
      expect(
        verifyShopifyWebhookHmac({ hmacHeader, rawBody: body, secret: SECRET })
      ).toBe(false);
    }
  });

  it("is sensitive to re-serialising the body", () => {
    const reserialised = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(body)), null, 1)
    );
    expect(
      verifyShopifyWebhookHmac({
        hmacHeader: sign(body),
        rawBody: reserialised,
        secret: SECRET,
      })
    ).toBe(false);
  });
});

describe("matchesWebhookTopic", () => {
  it("matches the header form of a topic to its enum name", () => {
    expect(matchesWebhookTopic("orders/create", "ORDERS_CREATE")).toBe(true);
    expect(
      matchesWebhookTopic("product_listings/add", "PRODUCT_LISTINGS_ADD")
    ).toBe(true);
    expect(matchesWebhookTopic("orders/updated", "ORDERS_CREATE")).toBe(false);
    expect(matchesWebhookTopic(null, "ORDERS_CREATE")).toBe(false);
  });
});
