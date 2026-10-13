import { defaultApiVersion } from "../keys";
import { normalizeShopDomain, shopOrigin } from "../shop-domain";
import { parseQueryCost, type ShopifyQueryCost } from "./cost";
import {
  ShopifyGraphqlError,
  ShopifyTransportError,
  toGraphqlErrors,
} from "./errors";

export const DEFAULT_ADMIN_TIMEOUT_MS = 60_000;

export interface AdminGraphqlRequest {
  /** Plaintext Admin API access token. Never logged or echoed back. */
  accessToken: string;
  apiVersion?: string | undefined;
  /** Asks Shopify for the per-field cost breakdown. */
  costDebug?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
  operationName?: string | undefined;
  query: string;
  shopDomain: string;
  timeoutMs?: number | undefined;
  variables?: Record<string, unknown> | undefined;
}

export interface AdminGraphqlResult {
  apiVersion: string;
  /** The parsed response body exactly as Shopify returned it. */
  body: unknown;
  cost: ShopifyQueryCost | undefined;
  httpStatus: number;
  requestId: string | undefined;
  /** Seconds from the `Retry-After` header, when Shopify sent one. */
  retryAfterSeconds: number | undefined;
  shopDomain: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTimeout = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

const parseRetryAfter = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : undefined;
};

/**
 * Sends one Admin GraphQL request and returns Shopify's answer untouched,
 * including GraphQL errors and failure statuses. It throws only when there is
 * no JSON answer to return.
 */
export const executeAdminGraphql = async (
  request: AdminGraphqlRequest
): Promise<AdminGraphqlResult> => {
  const shopDomain = normalizeShopDomain(request.shopDomain);
  const apiVersion = request.apiVersion ?? defaultApiVersion();
  const context = {
    apiVersion,
    operationName: request.operationName,
    shopDomain,
  };
  const fetchImpl = request.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(
      `${shopOrigin(shopDomain)}/admin/api/${apiVersion}/graphql.json`,
      {
        body: JSON.stringify({
          operationName: request.operationName,
          query: request.query,
          variables: request.variables,
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": request.accessToken,
          ...(request.costDebug ? { "Shopify-GraphQL-Cost-Debug": "1" } : {}),
        },
        method: "POST",
        signal: AbortSignal.timeout(
          request.timeoutMs ?? DEFAULT_ADMIN_TIMEOUT_MS
        ),
      }
    );
  } catch (error) {
    throw new ShopifyTransportError({
      ...context,
      failure: isTimeout(error) ? "timeout" : "network",
    });
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ShopifyTransportError({
      ...context,
      failure: isTimeout(error) ? "timeout" : "invalid-response",
      httpStatus: response.status,
      requestId,
    });
  }

  return {
    apiVersion,
    body,
    cost: parseQueryCost(body),
    httpStatus: response.status,
    requestId,
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    shopDomain,
  };
};

/**
 * Returns `data` from a result, raising `ShopifyGraphqlError` when Shopify
 * reported a failure status or any GraphQL error.
 */
export const unwrapAdminGraphqlData = <TData = unknown>(
  result: AdminGraphqlResult,
  operationName?: string
): TData => {
  const body = isRecord(result.body) ? result.body : undefined;
  const failed =
    result.httpStatus < 200 ||
    result.httpStatus >= 300 ||
    !body ||
    body.errors !== undefined;
  if (failed) {
    throw new ShopifyGraphqlError({
      apiVersion: result.apiVersion,
      graphqlErrors: toGraphqlErrors(body?.errors),
      httpStatus: result.httpStatus,
      operationName,
      requestId: result.requestId,
      shopDomain: result.shopDomain,
    });
  }
  return body.data as TData;
};

export const executeAdminGraphqlOrThrow = async <TData = unknown>(
  request: AdminGraphqlRequest
): Promise<TData> =>
  unwrapAdminGraphqlData<TData>(
    await executeAdminGraphql(request),
    request.operationName
  );
