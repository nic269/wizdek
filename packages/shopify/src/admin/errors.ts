export interface ShopifyGraphqlErrorDetail {
  extensions?: Record<string, unknown>;
  message?: string;
  path?: (string | number)[];
}

export interface ShopifyUserError {
  code?: string | null;
  field?: string[] | null;
  message: string;
}

interface RequestContext {
  apiVersion: string;
  operationName?: string | undefined;
  shopDomain: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shopify reports errors either as a GraphQL error list or, for authentication
 * failures, as a plain string.
 */
export const toGraphqlErrors = (
  errors: unknown
): ShopifyGraphqlErrorDetail[] => {
  if (typeof errors === "string") {
    return [{ message: errors }];
  }
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.map((error) => {
    if (!isRecord(error)) {
      return { message: String(error) };
    }
    const detail: ShopifyGraphqlErrorDetail = {};
    if (typeof error.message === "string") {
      detail.message = error.message;
    }
    if (Array.isArray(error.path)) {
      detail.path = error.path.filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number"
      );
    }
    if (isRecord(error.extensions)) {
      detail.extensions = error.extensions;
    }
    return detail;
  });
};

/** The request reached Shopify and came back with errors or a failure status. */
export class ShopifyGraphqlError extends Error {
  readonly apiVersion: string;
  readonly graphqlErrors: ShopifyGraphqlErrorDetail[];
  readonly httpStatus: number;
  readonly operationName: string | undefined;
  readonly requestId: string | undefined;
  readonly shopDomain: string;

  constructor(
    context: RequestContext & {
      graphqlErrors: ShopifyGraphqlErrorDetail[];
      httpStatus: number;
      requestId?: string | undefined;
    }
  ) {
    const label = context.operationName ?? "request";
    const firstMessage = context.graphqlErrors
      .map((error) => error.message)
      .find(Boolean);
    super(
      firstMessage
        ? `Shopify GraphQL ${label} failed: ${firstMessage}`
        : `Shopify GraphQL ${label} failed with HTTP ${context.httpStatus}.`
    );
    this.name = "ShopifyGraphqlError";
    this.apiVersion = context.apiVersion;
    this.graphqlErrors = context.graphqlErrors;
    this.httpStatus = context.httpStatus;
    this.operationName = context.operationName;
    this.requestId = context.requestId;
    this.shopDomain = context.shopDomain;
  }

  get isThrottled(): boolean {
    return (
      this.httpStatus === 429 ||
      this.graphqlErrors.some((error) => error.extensions?.code === "THROTTLED")
    );
  }
}

/** A mutation succeeded at the transport level but returned `userErrors`. */
export class ShopifyUserErrorsError extends Error {
  readonly apiVersion: string | undefined;
  readonly operationName: string;
  readonly shopDomain: string;
  readonly userErrors: ShopifyUserError[];

  constructor(context: {
    apiVersion?: string | undefined;
    operationName: string;
    shopDomain: string;
    userErrors: ShopifyUserError[];
  }) {
    const firstMessage = context.userErrors
      .map((error) => error.message)
      .find(Boolean);
    super(
      firstMessage
        ? `Shopify ${context.operationName} returned user error: ${firstMessage}`
        : `Shopify ${context.operationName} returned user errors.`
    );
    this.name = "ShopifyUserErrorsError";
    this.apiVersion = context.apiVersion;
    this.operationName = context.operationName;
    this.shopDomain = context.shopDomain;
    this.userErrors = context.userErrors;
  }
}

export type ShopifyTransportFailure =
  | "network"
  | "timeout"
  | "invalid-response";

/** No usable response: the network failed, the call timed out, or the body was not JSON. */
export class ShopifyTransportError extends Error {
  readonly apiVersion: string;
  readonly failure: ShopifyTransportFailure;
  readonly httpStatus: number | undefined;
  readonly operationName: string | undefined;
  readonly requestId: string | undefined;
  readonly shopDomain: string;

  constructor(
    context: RequestContext & {
      failure: ShopifyTransportFailure;
      httpStatus?: number | undefined;
      requestId?: string | undefined;
    }
  ) {
    super(
      `Shopify request to ${context.shopDomain} failed (${context.failure}).`
    );
    this.name = "ShopifyTransportError";
    this.apiVersion = context.apiVersion;
    this.failure = context.failure;
    this.httpStatus = context.httpStatus;
    this.operationName = context.operationName;
    this.requestId = context.requestId;
    this.shopDomain = context.shopDomain;
  }
}

export const throwShopifyUserErrors = (context: {
  apiVersion?: string | undefined;
  operationName: string;
  shopDomain: string;
  userErrors?: ShopifyUserError[] | null | undefined;
}): void => {
  const userErrors = context.userErrors?.filter((error) => error.message) ?? [];
  if (userErrors.length > 0) {
    throw new ShopifyUserErrorsError({ ...context, userErrors });
  }
};
