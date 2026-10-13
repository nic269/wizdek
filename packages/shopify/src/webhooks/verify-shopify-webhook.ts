import { createHmac } from "node:crypto";
import { safeEqual } from "../oauth/oauth-validation";

/**
 * Checks Shopify's signature on a webhook delivery. The signature is the
 * base64 HMAC-SHA256 of the request body exactly as it arrived, so it must be
 * computed over the raw bytes, before any parsing.
 */
export const verifyShopifyWebhookHmac = ({
  hmacHeader,
  rawBody,
  secret,
}: {
  hmacHeader: string | null | undefined;
  rawBody: Uint8Array;
  secret: string;
}): boolean => {
  if (!hmacHeader) {
    return false;
  }
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(digest, hmacHeader);
};

/**
 * Whether a delivery's topic header (`orders/create`) names the subscribed
 * topic (`ORDERS_CREATE`).
 */
export const matchesWebhookTopic = (
  topicHeader: string | null | undefined,
  topic: string
): boolean =>
  Boolean(topicHeader) &&
  topicHeader?.replaceAll("/", "_").toUpperCase() === topic;
