export interface ShopifyThrottleStatus {
  currentlyAvailable: number;
  maximumAvailable: number;
  restoreRate: number;
}

export interface ShopifyQueryCost {
  actualQueryCost?: number;
  /** Per-field breakdown, present only when cost debugging was requested. */
  fields?: unknown[];
  requestedQueryCost?: number;
  throttleStatus?: ShopifyThrottleStatus;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseThrottleStatus = (
  value: unknown
): ShopifyThrottleStatus | undefined => {
  if (!isRecord(value)) {
    return;
  }
  const currentlyAvailable = numberOrUndefined(value.currentlyAvailable);
  const maximumAvailable = numberOrUndefined(value.maximumAvailable);
  const restoreRate = numberOrUndefined(value.restoreRate);
  if (
    currentlyAvailable === undefined ||
    maximumAvailable === undefined ||
    restoreRate === undefined
  ) {
    return;
  }
  return { currentlyAvailable, maximumAvailable, restoreRate };
};

/** Reads `extensions.cost` from an Admin GraphQL response body. */
export const parseQueryCost = (body: unknown): ShopifyQueryCost | undefined => {
  if (!(isRecord(body) && isRecord(body.extensions))) {
    return;
  }
  const { cost } = body.extensions;
  if (!isRecord(cost)) {
    return;
  }

  const result: ShopifyQueryCost = {};
  const requestedQueryCost = numberOrUndefined(cost.requestedQueryCost);
  const actualQueryCost = numberOrUndefined(cost.actualQueryCost);
  const throttleStatus = parseThrottleStatus(cost.throttleStatus);
  if (requestedQueryCost !== undefined) {
    result.requestedQueryCost = requestedQueryCost;
  }
  if (actualQueryCost !== undefined) {
    result.actualQueryCost = actualQueryCost;
  }
  if (throttleStatus) {
    result.throttleStatus = throttleStatus;
  }
  if (Array.isArray(cost.fields)) {
    result.fields = cost.fields;
  }
  return result;
};
