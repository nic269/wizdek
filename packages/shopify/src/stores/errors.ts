/** The store does not exist, or belongs to another organization. */
export class StoreNotFoundError extends Error {
  readonly storeId: string;

  constructor(storeId: string) {
    super("Shopify store not found.");
    this.name = "StoreNotFoundError";
    this.storeId = storeId;
  }
}

/** The stored credentials can no longer produce a working access token. */
export class StoreReconnectRequiredError extends Error {
  readonly storeId: string;

  constructor(storeId: string, reason: string) {
    super(reason);
    this.name = "StoreReconnectRequiredError";
    this.storeId = storeId;
  }
}

export type StoreConnectionFailure =
  | "APP_NOT_FOUND"
  | "APP_IN_USE"
  | "CREDENTIALS_REJECTED"
  | "DOMAIN_TAKEN"
  | "SECRET_NOT_SET"
  | "SHOP_UNREACHABLE"
  | "STORE_IN_USE"
  | "STRATEGY_CONFLICT"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_SIGNATURE_INVALID"
  | "OAUTH_CALLBACK_INVALID"
  | "OAUTH_STORE_NOT_FOUND"
  | "OAUTH_STORE_AMBIGUOUS";

/** A connect, reconnect or registry action that could not be completed. */
export class StoreConnectionError extends Error {
  readonly details: unknown;
  readonly failure: StoreConnectionFailure;

  constructor(
    failure: StoreConnectionFailure,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "StoreConnectionError";
    this.details = details;
    this.failure = failure;
  }
}
