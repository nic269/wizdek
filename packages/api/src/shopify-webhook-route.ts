import {
  MAX_WEBHOOK_BYTES,
  receiveWebhookDelivery,
  WEBHOOK_PATH_PREFIX,
} from "@repo/flows";
import type { Context } from "hono";
import { getJobProvider } from "./jobs";

export const SHOPIFY_WEBHOOK_ROUTE = `${WEBHOOK_PATH_PREFIX}/:activationId`;

/**
 * Receives Shopify webhook deliveries for activated flows. The route has no
 * session: the signature over the raw body is the authentication, so the
 * body is read as bytes and verified before it is parsed. Refusals say
 * nothing about why, and the work itself is queued so the answer is quick.
 */
export const handleShopifyWebhook = async (context: Context) => {
  const declared = Number(context.req.header("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) {
    return context.body(null, 413);
  }
  const rawBody = new Uint8Array(await context.req.arrayBuffer());
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return context.body(null, 413);
  }

  const outcome = await receiveWebhookDelivery(
    {
      activationId: context.req.param("activationId") ?? "",
      deliveryId: context.req.header("x-shopify-webhook-id") ?? null,
      hmacHeader: context.req.header("x-shopify-hmac-sha256") ?? null,
      rawBody,
      shopDomainHeader: context.req.header("x-shopify-shop-domain") ?? null,
      topicHeader: context.req.header("x-shopify-topic") ?? null,
    },
    { jobs: getJobProvider() }
  );
  return context.body(null, outcome.status);
};
