import { normalizeShopDomain, shopOrigin } from "../shop-domain";
import type {
  ShopifyTokenGrant,
  ShopifyTokenRequestOptions,
  ShopifyTokenResult,
} from "./types";

export const DEFAULT_TOKEN_TIMEOUT_MS = 30_000;

interface TokenEndpointResponse {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
}

/**
 * A token request Shopify answered with a refusal, or that never completed.
 * Carries the OAuth error code only; the request body holds secrets and is
 * never attached.
 */
export class ShopifyOAuthError extends Error {
  readonly code: string | undefined;
  readonly grant: ShopifyTokenGrant;
  readonly httpStatus: number | undefined;
  readonly shopDomain: string;

  constructor(context: {
    code?: string | undefined;
    description?: string | undefined;
    grant: ShopifyTokenGrant;
    httpStatus?: number | undefined;
    shopDomain: string;
  }) {
    super(
      context.description ??
        context.code ??
        `Shopify ${context.grant} token request failed${
          context.httpStatus ? ` with HTTP ${context.httpStatus}` : ""
        }.`
    );
    this.name = "ShopifyOAuthError";
    this.code = context.code;
    this.grant = context.grant;
    this.httpStatus = context.httpStatus;
    this.shopDomain = context.shopDomain;
  }

  /** Shopify refused the credentials, so retrying the same request cannot succeed. */
  get isRejection(): boolean {
    return (
      this.httpStatus !== undefined &&
      this.httpStatus >= 400 &&
      this.httpStatus < 500 &&
      this.httpStatus !== 429
    );
  }
}

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const expiryFrom = (seconds: unknown, now: number): Date | undefined =>
  typeof seconds === "number" && seconds > 0
    ? new Date(now + seconds * 1000)
    : undefined;

const scopesFrom = (scope: unknown): string[] =>
  typeof scope === "string"
    ? scope
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

export const requestShopifyToken = async ({
  encoding = "form",
  fetchImpl = fetch,
  grant,
  params,
  shop,
  timeoutMs = DEFAULT_TOKEN_TIMEOUT_MS,
}: ShopifyTokenRequestOptions & {
  encoding?: "form" | "json";
  grant: ShopifyTokenGrant;
  params: Record<string, string>;
  shop: string;
}): Promise<ShopifyTokenResult> => {
  const shopDomain = normalizeShopDomain(shop);
  const failure = { grant, shopDomain };

  let response: Response;
  let body: TokenEndpointResponse | null;
  try {
    response = await fetchImpl(
      `${shopOrigin(shopDomain)}/admin/oauth/access_token`,
      {
        body:
          encoding === "json"
            ? JSON.stringify(params)
            : new URLSearchParams(params),
        headers: {
          Accept: "application/json",
          "Content-Type":
            encoding === "json"
              ? "application/json"
              : "application/x-www-form-urlencoded",
        },
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    body = (await response
      .json()
      .catch(() => null)) as TokenEndpointResponse | null;
  } catch {
    throw new ShopifyOAuthError(failure);
  }

  const accessToken = stringOrUndefined(body?.access_token);
  if (!(response.ok && accessToken)) {
    throw new ShopifyOAuthError({
      ...failure,
      code: stringOrUndefined(body?.error),
      description: stringOrUndefined(body?.error_description),
      httpStatus: response.status,
    });
  }

  const now = Date.now();
  return {
    accessToken,
    accessTokenExpiresAt: expiryFrom(body?.expires_in, now),
    grant,
    refreshToken: stringOrUndefined(body?.refresh_token),
    refreshTokenExpiresAt: expiryFrom(body?.refresh_token_expires_in, now),
    scopes: scopesFrom(body?.scope),
  };
};
