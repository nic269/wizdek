import type { AdminGraphqlResult } from "./admin-client";
import type { ShopifyQueryCost, ShopifyThrottleStatus } from "./cost";
import { ShopifyTransportError } from "./errors";

/** Wait used when Shopify throttles without saying how full the bucket is. */
const FALLBACK_THROTTLE_WAIT_MS = 1000;
const TRANSPORT_BACKOFF_MS = [1000, 2000, 4000] as const;

interface BucketState {
  lastRequestedCost: number;
  observedAt: number;
  status: ShopifyThrottleStatus;
}

/**
 * The last cost bucket each store reported, kept per process. Another process
 * may drain the same bucket; that case is absorbed by retrying on THROTTLED.
 */
const buckets = new Map<string, BucketState>();

export const resetThrottleState = (): void => {
  buckets.clear();
};

export const rememberThrottle = (
  shopDomain: string,
  cost: ShopifyQueryCost | undefined,
  now = Date.now()
): void => {
  if (!cost?.throttleStatus) {
    return;
  }
  buckets.set(shopDomain, {
    lastRequestedCost: cost.requestedQueryCost ?? 1,
    observedAt: now,
    status: cost.throttleStatus,
  });
};

/**
 * How long to hold a request so the store's bucket, refilling at its restore
 * rate since it was last seen, can cover the expected cost. Zero when the
 * bucket is unknown or already sufficient.
 */
export const waitBeforeRequestMs = (
  shopDomain: string,
  expectedCost?: number,
  now = Date.now()
): number => {
  const bucket = buckets.get(shopDomain);
  if (!bucket || bucket.status.restoreRate <= 0) {
    return 0;
  }
  const { currentlyAvailable, maximumAvailable, restoreRate } = bucket.status;
  const needed = Math.min(
    expectedCost ?? bucket.lastRequestedCost,
    maximumAvailable
  );
  const elapsedSeconds = Math.max(0, now - bucket.observedAt) / 1000;
  const projected = Math.min(
    maximumAvailable,
    currentlyAvailable + elapsedSeconds * restoreRate
  );
  return projected >= needed
    ? 0
    : Math.ceil(((needed - projected) / restoreRate) * 1000);
};

/** How long to wait after a THROTTLED answer before the same request can pass. */
export const waitAfterThrottleMs = (
  cost: ShopifyQueryCost | undefined
): number => {
  const status = cost?.throttleStatus;
  if (!status || status.restoreRate <= 0) {
    return FALLBACK_THROTTLE_WAIT_MS;
  }
  const needed = Math.min(
    cost.requestedQueryCost ?? status.maximumAvailable,
    status.maximumAvailable
  );
  const missing = needed - status.currentlyAvailable;
  return missing <= 0
    ? FALLBACK_THROTTLE_WAIT_MS
    : Math.ceil((missing / status.restoreRate) * 1000);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isThrottledResult = (result: AdminGraphqlResult): boolean => {
  if (result.httpStatus === 429) {
    return true;
  }
  const errors = isRecord(result.body) ? result.body.errors : undefined;
  return (
    Array.isArray(errors) &&
    errors.some(
      (error) =>
        isRecord(error) &&
        isRecord(error.extensions) &&
        error.extensions.code === "THROTTLED"
    )
  );
};

/** Resolves after the delay, or rejects as soon as the signal aborts. */
export const abortableSleep = (
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export interface RetryOptions {
  /** Query cost to reserve before sending; defaults to the last cost seen. */
  expectedCost?: number | undefined;
  /** How many THROTTLED answers to wait out before giving up. */
  maxThrottleRetries?: number | undefined;
  /**
   * Retry after a network failure or a 5xx. Such a request may have been
   * applied, so pass false for a mutation that is not safe to repeat.
   */
  retryUncertain?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** Replaces the timer; for tests. */
  sleep?:
    | ((milliseconds: number, signal?: AbortSignal) => Promise<void>)
    | undefined;
}

const DEFAULT_THROTTLE_RETRIES = 10;

interface RetryBudget {
  maxThrottleRetries: number;
  retryUncertain: boolean;
  throttleRetries: number;
  uncertainRetries: number;
}

/** Spends one uncertain retry and returns its backoff, if any is left. */
const takeUncertainBackoff = (budget: RetryBudget): number | undefined => {
  const backoff = budget.retryUncertain
    ? TRANSPORT_BACKOFF_MS[budget.uncertainRetries]
    : undefined;
  if (backoff !== undefined) {
    budget.uncertainRetries += 1;
  }
  return backoff;
};

/** How long to wait before repeating the request, or undefined to return it. */
const delayBeforeRepeat = (
  result: AdminGraphqlResult,
  budget: RetryBudget
): number | undefined => {
  if (isThrottledResult(result)) {
    if (budget.throttleRetries >= budget.maxThrottleRetries) {
      return;
    }
    budget.throttleRetries += 1;
    return Math.max(
      waitAfterThrottleMs(result.cost),
      (result.retryAfterSeconds ?? 0) * 1000
    );
  }
  return result.httpStatus >= 500 ? takeUncertainBackoff(budget) : undefined;
};

/**
 * Sends a request for background work: paces it against the store's cost
 * bucket, waits out THROTTLED answers, and retries transient failures.
 * A THROTTLED request was not executed, so waiting it out is always safe.
 */
export const sendWithRetry = async (
  shopDomain: string,
  send: () => Promise<AdminGraphqlResult>,
  options: RetryOptions = {}
): Promise<AdminGraphqlResult> => {
  const sleep = options.sleep ?? abortableSleep;
  const budget: RetryBudget = {
    maxThrottleRetries: options.maxThrottleRetries ?? DEFAULT_THROTTLE_RETRIES,
    retryUncertain: options.retryUncertain ?? true,
    throttleRetries: 0,
    uncertainRetries: 0,
  };

  for (;;) {
    options.signal?.throwIfAborted();
    const hold = waitBeforeRequestMs(shopDomain, options.expectedCost);
    if (hold > 0) {
      await sleep(hold, options.signal);
    }

    let delay: number | undefined;
    try {
      const result = await send();
      rememberThrottle(shopDomain, result.cost);
      delay = delayBeforeRepeat(result, budget);
      if (delay === undefined) {
        return result;
      }
    } catch (error) {
      delay =
        error instanceof ShopifyTransportError
          ? takeUncertainBackoff(budget)
          : undefined;
      if (delay === undefined) {
        throw error;
      }
    }
    await sleep(delay, options.signal);
  }
};
