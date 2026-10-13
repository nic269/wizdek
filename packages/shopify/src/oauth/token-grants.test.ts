import { describe, expect, it, vi } from "vitest";
import { requestClientCredentialsToken } from "./client-credentials";
import { refreshAccessToken } from "./refresh-access-token";
import { createShopifyTokenService } from "./shopify-token-service";
import { ShopifyOAuthError } from "./token-endpoint";

const credentials = { clientId: "client-id", clientSecret: "client-secret" };

const respondWith = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }));

const sentParams = (fetchImpl: ReturnType<typeof respondWith>) => {
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  const body = init?.body;
  return {
    params:
      typeof body === "string"
        ? (JSON.parse(body) as Record<string, string>)
        : Object.fromEntries(body as URLSearchParams),
    url: String(url),
  };
};

describe("token grants", () => {
  it("exchanges an authorization code, asking for an expiring token on request", async () => {
    const fetchImpl = respondWith({
      access_token: "shpat_1",
      expires_in: 3600,
      refresh_token: "shprt_1",
      refresh_token_expires_in: 7_776_000,
      scope: "read_orders, write_orders",
    });
    const before = Date.now();

    const token = await createShopifyTokenService(credentials, {
      expiring: true,
      fetchImpl,
    }).exchange({
      code: "code-1",
      rawQuery: new URLSearchParams(),
      shop: "Example.myshopify.com",
    });

    const { params, url } = sentParams(fetchImpl);
    expect(url).toBe("https://example.myshopify.com/admin/oauth/access_token");
    expect(params).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "code-1",
      expiring: "1",
    });
    expect(token).toMatchObject({
      accessToken: "shpat_1",
      grant: "authorization-code",
      refreshToken: "shprt_1",
      scopes: ["read_orders", "write_orders"],
    });
    expect(token.accessTokenExpiresAt?.getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000
    );
  });

  it("prefers token exchange when an id token is present and omits expiring by default", async () => {
    const fetchImpl = respondWith({ access_token: "shpat_2", scope: "" });

    const token = await createShopifyTokenService(credentials, {
      fetchImpl,
    }).exchange({
      code: "code-1",
      idToken: "id-token",
      rawQuery: new URLSearchParams(),
      shop: "example.myshopify.com",
    });

    const { params } = sentParams(fetchImpl);
    expect(params.grant_type).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange"
    );
    expect(params.subject_token).toBe("id-token");
    expect(params).not.toHaveProperty("expiring");
    expect(token).toMatchObject({
      accessTokenExpiresAt: undefined,
      grant: "token-exchange",
      refreshToken: undefined,
      scopes: [],
    });
  });

  it("sends the refresh grant", async () => {
    const fetchImpl = respondWith({
      access_token: "shpat_3",
      expires_in: 3600,
      refresh_token: "shprt_3",
    });

    const token = await refreshAccessToken(
      {
        ...credentials,
        refreshToken: "shprt_2",
        shop: "example.myshopify.com",
      },
      { fetchImpl }
    );

    expect(sentParams(fetchImpl).params).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "refresh_token",
      refresh_token: "shprt_2",
    });
    expect(token.refreshToken).toBe("shprt_3");
  });

  it("sends the client credentials grant", async () => {
    const fetchImpl = respondWith({
      access_token: "shpat_4",
      expires_in: 86_399,
      scope: "read_orders",
    });

    const token = await requestClientCredentialsToken(
      { ...credentials, shop: "example.myshopify.com" },
      { fetchImpl }
    );

    expect(sentParams(fetchImpl).params).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "client_credentials",
    });
    expect(token.grant).toBe("client-credentials");
    expect(token.refreshToken).toBeUndefined();
  });

  it("reports a refusal without leaking the client secret", async () => {
    const fetchImpl = respondWith({ error: "invalid_grant" }, 400);

    const error = await refreshAccessToken(
      {
        ...credentials,
        refreshToken: "shprt_2",
        shop: "example.myshopify.com",
      },
      { fetchImpl }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ShopifyOAuthError);
    expect(error).toMatchObject({
      code: "invalid_grant",
      httpStatus: 400,
      isRejection: true,
    });
    expect(JSON.stringify(error)).not.toContain("client-secret");
    expect((error as Error).message).not.toContain("client-secret");
  });

  it("treats a network failure as retryable and never calls another host", async () => {
    const failing = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("fetch failed"))
    );
    const error = await requestClientCredentialsToken(
      { ...credentials, shop: "example.myshopify.com" },
      { fetchImpl: failing }
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ httpStatus: undefined, isRejection: false });

    const unused = respondWith({});
    await expect(
      requestClientCredentialsToken(
        { ...credentials, shop: "evil.com" },
        { fetchImpl: unused }
      )
    ).rejects.toThrow("Invalid Shopify shop domain.");
    expect(unused).not.toHaveBeenCalled();
  });
});
