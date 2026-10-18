import { InvalidShopDomainError } from "@repo/shopify";
import {
  StoreConnectionError,
  type StoreConnectionFailure,
  StoreNotFoundError,
} from "@repo/shopify/stores";
import { ApiError } from "../errors";

const FAILURE_RESPONSES: Record<
  StoreConnectionFailure,
  { code: string; status: 404 | 409 | 422 | 503 }
> = {
  APP_IN_USE: { code: "CONFLICT", status: 409 },
  APP_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  CREDENTIALS_REJECTED: { code: "VALIDATION_ERROR", status: 422 },
  DOMAIN_TAKEN: { code: "CONFLICT", status: 409 },
  OAUTH_CALLBACK_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  OAUTH_SIGNATURE_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  OAUTH_STATE_INVALID: { code: "VALIDATION_ERROR", status: 422 },
  OAUTH_STORE_AMBIGUOUS: { code: "CONFLICT", status: 409 },
  OAUTH_STORE_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  SECRET_NOT_SET: { code: "NOT_FOUND", status: 404 },
  SHOP_UNREACHABLE: { code: "SERVICE_UNAVAILABLE", status: 503 },
  STORE_IN_USE: { code: "CONFLICT", status: 409 },
  STRATEGY_CONFLICT: { code: "CONFLICT", status: 409 },
};

/** Runs a Shopify service call, turning its domain errors into API errors. */
export const withShopifyErrors = async <T>(
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidShopDomainError) {
      throw new ApiError("VALIDATION_ERROR", error.message, 422);
    }
    if (error instanceof StoreNotFoundError) {
      throw new ApiError("NOT_FOUND", "Store not found.", 404);
    }
    if (error instanceof StoreConnectionError) {
      const { code, status } = FAILURE_RESPONSES[error.failure];
      throw new ApiError(code, error.message, status, {
        reason: error.failure,
        ...(error.details && typeof error.details === "object"
          ? error.details
          : {}),
      });
    }
    throw error;
  }
};
