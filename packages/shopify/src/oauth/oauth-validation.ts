import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { normalizeShopDomain } from "../shop-domain";
import type { ShopifySessionTokenPayload } from "./types";

export const hashOAuthState = (state: string): string =>
  createHash("sha256").update(state).digest("hex");

export const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyShopifyOAuthHmac = (
  query: URLSearchParams,
  clientSecret: string
): boolean => {
  const hmac = query.get("hmac");
  if (!hmac) {
    return false;
  }

  const message = [...query.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");
  return safeEqual(digest, hmac);
};

const decodeSegment = <T>(value: string): T =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;

const shopFromDestination = (destination: string): string => {
  try {
    return normalizeShopDomain(new URL(destination).hostname);
  } catch {
    throw new Error("Invalid Shopify session token destination.");
  }
};

const issuerHost = (issuer: string): string => {
  try {
    return new URL(issuer).hostname;
  } catch {
    throw new Error("Invalid Shopify session token issuer.");
  }
};

export const verifyAndDecodeShopifySessionToken = (
  idToken: string,
  clientId: string,
  clientSecret: string,
  expectedShop?: string
): ShopifySessionTokenPayload => {
  const [encodedHeader, encodedPayload, signature] = idToken.split(".");
  if (!(encodedHeader && encodedPayload && signature)) {
    throw new Error("Malformed Shopify session token.");
  }

  const header = decodeSegment<{ alg?: string }>(encodedHeader);
  if (header.alg !== "HS256") {
    throw new Error("Unsupported Shopify session token algorithm.");
  }

  const expectedSignature = createHmac("sha256", clientSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  if (!safeEqual(expectedSignature, signature)) {
    throw new Error("Invalid Shopify session token signature.");
  }

  const payload = decodeSegment<ShopifySessionTokenPayload>(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId) {
    throw new Error("Invalid Shopify session token audience.");
  }
  if (payload.nbf > now || payload.exp <= now) {
    throw new Error("Expired Shopify session token.");
  }

  const shop = shopFromDestination(payload.dest);
  if (expectedShop && shop !== normalizeShopDomain(expectedShop)) {
    throw new Error("Shopify session token shop mismatch.");
  }
  if (issuerHost(payload.iss) !== shop) {
    throw new Error("Shopify session token issuer mismatch.");
  }

  return payload;
};
