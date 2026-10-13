import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminGraphqlResult } from "./admin-client";
import { ShopifyTransportError } from "./errors";
import {
  abortableSleep,
  isThrottledResult,
  rememberThrottle,
  resetThrottleState,
  sendWithRetry,
  waitAfterThrottleMs,
  waitBeforeRequestMs,
} from "./throttle";

const SHOP = "example.myshopify.com";

const bucket = (currentlyAvailable: number) => ({
  currentlyAvailable,
  maximumAvailable: 2000,
  restoreRate: 100,
});

const result = (
  overrides: Partial<AdminGraphqlResult> = {}
): AdminGraphqlResult => ({
  apiVersion: "2026-07",
  body: { data: { shop: { name: "Example" } } },
  cost: { requestedQueryCost: 10, throttleStatus: bucket(1990) },
  httpStatus: 200,
  requestId: "req-1",
  retryAfterSeconds: undefined,
  shopDomain: SHOP,
  ...overrides,
});

const throttled = (requestedQueryCost: number, currentlyAvailable: number) =>
  result({
    body: {
      errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
    },
    cost: { requestedQueryCost, throttleStatus: bucket(currentlyAvailable) },
  });

const transportError = () =>
  new ShopifyTransportError({
    apiVersion: "2026-07",
    failure: "network",
    shopDomain: SHOP,
  });

beforeEach(() => {
  resetThrottleState();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bucket projection", () => {
  it("does not hold a request for an unknown or sufficient bucket", () => {
    expect(waitBeforeRequestMs(SHOP, 500)).toBe(0);
    rememberThrottle(SHOP, {
      requestedQueryCost: 10,
      throttleStatus: bucket(600),
    });
    expect(waitBeforeRequestMs(SHOP, 500)).toBe(0);
  });

  it("holds until the bucket has refilled enough, crediting time already passed", () => {
    rememberThrottle(SHOP, {
      requestedQueryCost: 10,
      throttleStatus: bucket(100),
    });

    expect(waitBeforeRequestMs(SHOP, 500)).toBe(4000);
    vi.advanceTimersByTime(1500);
    expect(waitBeforeRequestMs(SHOP, 500)).toBe(2500);
    vi.advanceTimersByTime(2500);
    expect(waitBeforeRequestMs(SHOP, 500)).toBe(0);
  });

  it("defaults to the last cost seen and never waits for more than a full bucket", () => {
    rememberThrottle(SHOP, {
      requestedQueryCost: 300,
      throttleStatus: bucket(0),
    });
    expect(waitBeforeRequestMs(SHOP)).toBe(3000);
    expect(waitBeforeRequestMs(SHOP, 999_999)).toBe(20_000);
  });

  it("computes the wait after a THROTTLED answer", () => {
    expect(
      waitAfterThrottleMs({
        requestedQueryCost: 500,
        throttleStatus: bucket(100),
      })
    ).toBe(4000);
    expect(waitAfterThrottleMs(undefined)).toBe(1000);
    expect(
      waitAfterThrottleMs({
        requestedQueryCost: 50,
        throttleStatus: bucket(100),
      })
    ).toBe(1000);
  });
});

describe("isThrottledResult", () => {
  it("recognises the THROTTLED error code and HTTP 429 only", () => {
    expect(isThrottledResult(throttled(10, 0))).toBe(true);
    expect(isThrottledResult(result({ httpStatus: 429 }))).toBe(true);
    expect(isThrottledResult(result())).toBe(false);
    expect(
      isThrottledResult(
        result({ body: { errors: [{ message: "Field error" }] } })
      )
    ).toBe(false);
  });
});

describe("sendWithRetry", () => {
  it("waits out THROTTLED answers, then returns the successful one", async () => {
    const send = vi
      .fn<() => Promise<AdminGraphqlResult>>()
      .mockResolvedValueOnce(throttled(500, 100))
      .mockResolvedValueOnce(throttled(500, 300))
      .mockResolvedValue(result());
    const sleeps: number[] = [];

    const pending = sendWithRetry(SHOP, send, {
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        vi.advanceTimersByTime(milliseconds);
        return Promise.resolve();
      },
    });

    await expect(pending).resolves.toMatchObject({ httpStatus: 200 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([4000, 2000]);
  });

  it("holds the next request when the remembered bucket is too low", async () => {
    rememberThrottle(SHOP, {
      requestedQueryCost: 400,
      throttleStatus: bucket(100),
    });
    const send = vi.fn(async () => result());
    const sleeps: number[] = [];

    await sendWithRetry(SHOP, send, {
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        vi.advanceTimersByTime(milliseconds);
        return Promise.resolve();
      },
    });

    expect(sleeps).toEqual([3000]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gives back the THROTTLED answer once the retry budget is spent", async () => {
    const send = vi.fn(async () => throttled(500, 100));

    const answer = await sendWithRetry(SHOP, send, {
      maxThrottleRetries: 2,
      sleep: () => Promise.resolve(),
    });

    expect(isThrottledResult(answer)).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("retries network failures and 5xx with backoff, at most three times", async () => {
    const sleeps: number[] = [];
    const sleep = (milliseconds: number) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    };
    const flaky = vi
      .fn<() => Promise<AdminGraphqlResult>>()
      .mockRejectedValueOnce(transportError())
      .mockResolvedValueOnce(result({ cost: undefined, httpStatus: 502 }))
      .mockResolvedValue(result());

    await expect(sendWithRetry(SHOP, flaky, { sleep })).resolves.toMatchObject({
      httpStatus: 200,
    });
    expect(sleeps).toEqual([1000, 2000]);

    const down = vi.fn<() => Promise<AdminGraphqlResult>>(() =>
      Promise.reject(transportError())
    );
    await expect(sendWithRetry(SHOP, down, { sleep })).rejects.toBeInstanceOf(
      ShopifyTransportError
    );
    expect(down).toHaveBeenCalledTimes(4);
  });

  it("does not repeat an uncertain request when told it is unsafe", async () => {
    const failing = vi.fn<() => Promise<AdminGraphqlResult>>(() =>
      Promise.reject(transportError())
    );
    await expect(
      sendWithRetry(SHOP, failing, { retryUncertain: false })
    ).rejects.toBeInstanceOf(ShopifyTransportError);
    expect(failing).toHaveBeenCalledTimes(1);

    const serverError = vi.fn(async () =>
      result({ cost: undefined, httpStatus: 503 })
    );
    await expect(
      sendWithRetry(SHOP, serverError, { retryUncertain: false })
    ).resolves.toMatchObject({ httpStatus: 503 });
    expect(serverError).toHaveBeenCalledTimes(1);

    // A throttled request was never executed, so it is still retried.
    const throttledOnce = vi
      .fn<() => Promise<AdminGraphqlResult>>()
      .mockResolvedValueOnce(throttled(10, 0))
      .mockResolvedValue(result());
    await sendWithRetry(SHOP, throttledOnce, {
      retryUncertain: false,
      sleep: () => Promise.resolve(),
    });
    expect(throttledOnce).toHaveBeenCalledTimes(2);
  });

  it("stops waiting as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => throttled(2000, 0));

    const pending = sendWithRetry(SHOP, send, { signal: controller.signal });
    const outcome = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(new Error("shutting down"));

    await expect(outcome).resolves.toMatchObject({ message: "shutting down" });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(abortableSleep(10, controller.signal)).rejects.toThrow(
      "shutting down"
    );
  });
});
