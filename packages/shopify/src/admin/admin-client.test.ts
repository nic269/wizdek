import { describe, expect, it, vi } from "vitest";
import {
  executeAdminGraphql,
  executeAdminGraphqlOrThrow,
} from "./admin-client";
import {
  ShopifyGraphqlError,
  ShopifyTransportError,
  ShopifyUserErrorsError,
  throwShopifyUserErrors,
} from "./errors";

const TOKEN = "shpat_secret_value";

const respondWith = (
  body: unknown,
  init: ResponseInit = { headers: { "x-request-id": "req-1" } }
) => vi.fn<typeof fetch>(async () => Response.json(body, init));

const baseRequest = {
  accessToken: TOKEN,
  apiVersion: "2026-07",
  query: "query Shop { shop { name } }",
  shopDomain: "Example.myshopify.com",
};

describe("executeAdminGraphql", () => {
  it("posts to the validated shop and returns the raw body with cost", async () => {
    const body = {
      data: { shop: { name: "Example" } },
      extensions: { cost: { actualQueryCost: 1, requestedQueryCost: 1 } },
    };
    const fetchImpl = respondWith(body);

    const result = await executeAdminGraphql({
      ...baseRequest,
      fetchImpl,
      operationName: "Shop",
      variables: { first: 1 },
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(url).toBe(
      "https://example.myshopify.com/admin/api/2026-07/graphql.json"
    );
    expect(headers["X-Shopify-Access-Token"]).toBe(TOKEN);
    expect(headers).not.toHaveProperty("Shopify-GraphQL-Cost-Debug");
    expect(JSON.parse(init?.body as string)).toEqual({
      operationName: "Shop",
      query: baseRequest.query,
      variables: { first: 1 },
    });
    expect(result).toMatchObject({
      body,
      cost: { actualQueryCost: 1, requestedQueryCost: 1 },
      httpStatus: 200,
      requestId: "req-1",
      shopDomain: "example.myshopify.com",
    });
  });

  it("asks for the cost breakdown only when requested", async () => {
    const fetchImpl = respondWith({ data: {} });
    await executeAdminGraphql({ ...baseRequest, costDebug: true, fetchImpl });

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["Shopify-GraphQL-Cost-Debug"]).toBe("1");
  });

  it("passes GraphQL errors and failure statuses through untouched", async () => {
    const errorBody = {
      data: null,
      errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
    };
    const throttled = await executeAdminGraphql({
      ...baseRequest,
      fetchImpl: respondWith(errorBody),
    });
    expect(throttled.body).toEqual(errorBody);

    const unauthorized = await executeAdminGraphql({
      ...baseRequest,
      fetchImpl: respondWith(
        { errors: "[API] Invalid API key or access token" },
        { headers: { "retry-after": "2" }, status: 401 }
      ),
    });
    expect(unauthorized.httpStatus).toBe(401);
    expect(unauthorized.retryAfterSeconds).toBe(2);
  });

  it("refuses a shop domain that is not a myshopify domain", async () => {
    const fetchImpl = respondWith({});
    await expect(
      executeAdminGraphql({
        ...baseRequest,
        fetchImpl,
        shopDomain: "a.myshopify.com.evil.com",
      })
    ).rejects.toThrow("Invalid Shopify shop domain.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("raises a transport error without the token for network, timeout and non-JSON failures", async () => {
    const network = await executeAdminGraphql({
      ...baseRequest,
      fetchImpl: vi.fn<typeof fetch>(() =>
        Promise.reject(new TypeError(`fetch failed for ${TOKEN}`))
      ),
    }).catch((error: unknown) => error);
    expect(network).toBeInstanceOf(ShopifyTransportError);
    expect(network).toMatchObject({ failure: "network" });
    expect(JSON.stringify(network)).not.toContain(TOKEN);
    expect((network as Error).message).not.toContain(TOKEN);

    const timeout = await executeAdminGraphql({
      ...baseRequest,
      fetchImpl: vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason)
            );
          })
      ),
      timeoutMs: 10,
    }).catch((error: unknown) => error);
    expect(timeout).toMatchObject({ failure: "timeout" });

    const html = await executeAdminGraphql({
      ...baseRequest,
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response("<html>Bad gateway</html>", { status: 502 })
      ),
    }).catch((error: unknown) => error);
    expect(html).toMatchObject({
      failure: "invalid-response",
      httpStatus: 502,
    });
  });
});

describe("executeAdminGraphqlOrThrow", () => {
  it("returns data on success", async () => {
    await expect(
      executeAdminGraphqlOrThrow<{ shop: { name: string } }>({
        ...baseRequest,
        fetchImpl: respondWith({ data: { shop: { name: "Example" } } }),
      })
    ).resolves.toEqual({ shop: { name: "Example" } });
  });

  it("throws on GraphQL errors and on failure statuses, without the token", async () => {
    const throttled = await executeAdminGraphqlOrThrow({
      ...baseRequest,
      fetchImpl: respondWith({
        errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
      }),
      operationName: "Shop",
    }).catch((error: unknown) => error);
    expect(throttled).toBeInstanceOf(ShopifyGraphqlError);
    expect(throttled).toMatchObject({
      isThrottled: true,
      operationName: "Shop",
      requestId: "req-1",
      shopDomain: "example.myshopify.com",
    });
    expect(JSON.stringify(throttled)).not.toContain(TOKEN);

    const unauthorized = await executeAdminGraphqlOrThrow({
      ...baseRequest,
      fetchImpl: respondWith(
        { errors: "[API] Invalid API key or access token" },
        { status: 401 }
      ),
    }).catch((error: unknown) => error);
    expect(unauthorized).toMatchObject({ httpStatus: 401, isThrottled: false });
    expect((unauthorized as Error).message).toContain("Invalid API key");
  });
});

describe("throwShopifyUserErrors", () => {
  it("throws only when a user error carries a message", () => {
    const context = { operationName: "tagsAdd", shopDomain: "a.myshopify.com" };

    expect(() =>
      throwShopifyUserErrors({ ...context, userErrors: [] })
    ).not.toThrow();
    expect(() => throwShopifyUserErrors(context)).not.toThrow();
    expect(() =>
      throwShopifyUserErrors({
        ...context,
        userErrors: [{ field: ["id"], message: "Order does not exist" }],
      })
    ).toThrow(ShopifyUserErrorsError);
  });
});
