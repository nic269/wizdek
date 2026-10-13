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
