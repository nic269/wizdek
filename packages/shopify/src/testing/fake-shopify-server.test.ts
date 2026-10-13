import { getIntrospectionQuery } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type FakeShopifyServer,
  startFakeShopifyServer,
} from "./fake-shopify-server";

let server: FakeShopifyServer;

beforeAll(async () => {
  server = await startFakeShopifyServer();
  server.acceptToken("shpat_valid");
});

afterAll(async () => {
  await server.close();
});

const admin = async (
  query: string,
  variables?: Record<string, unknown>,
  token = "shpat_valid"
) => {
  const response = await fetch(`${server.url}/admin/api/2026-07/graphql.json`, {
    body: JSON.stringify({ query, variables }),
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    method: "POST",
  });
  return {
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      errors?: unknown;
      extensions?: { cost?: unknown };
    },
    status: response.status,
  };
};

describe("fake Shopify server", () => {
  it("answers introspection and the shop query with a cost extension", async () => {
    const introspection = await admin(getIntrospectionQuery());
    expect(introspection.body.data?.__schema).toBeDefined();

    const shop = await admin("{ shop { name myshopifyDomain currencyCode } }");
    expect(shop.body.data?.shop).toEqual({
      currencyCode: "USD",
      myshopifyDomain: "fake-store.myshopify.com",
      name: "Fake Store",
    });
    expect(shop.body.extensions?.cost).toMatchObject({ requestedQueryCost: 3 });
  });

  it("looks orders up and adds tags without duplicating them", async () => {
    server.seedOrder({
      id: "gid://shopify/Order/1",
      name: "#1001",
      tags: ["vip"],
      totalPrice: "1500.00",
    });
    const mutation =
      "mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }";

    const lookup = await admin(
      '{ orders(first: 1, query: "name:#1001") { nodes { id totalPriceSet { shopMoney { amount } } } } }'
    );
    expect(lookup.body.data?.orders).toEqual({
      nodes: [
        {
          id: "gid://shopify/Order/1",
          totalPriceSet: { shopMoney: { amount: "1500.00" } },
        },
      ],
    });

    const variables = { id: "gid://shopify/Order/1", tags: ["high-value"] };
    await admin(mutation, variables);
    const repeated = await admin(mutation, variables);
    expect(repeated.body.data?.tagsAdd).toEqual({
      node: { id: "gid://shopify/Order/1" },
      userErrors: [],
    });
    expect(server.order("gid://shopify/Order/1")?.tags).toEqual([
      "high-value",
      "vip",
    ]);

    const missing = await admin(mutation, {
      id: "gid://shopify/Order/404",
      tags: ["x"],
    });
    expect(missing.body.data?.tagsAdd).toMatchObject({
      node: null,
      userErrors: [{ message: "Order does not exist" }],
    });
  });

  it("simulates throttling and unauthorized responses on demand", async () => {
    server.throttleNext();
    const throttled = await admin("{ shop { name } }");
    expect(throttled.status).toBe(200);
    expect(throttled.body.errors).toEqual([
      { extensions: { code: "THROTTLED" }, message: "Throttled" },
    ]);

    server.failNextWithUnauthorized();
    expect((await admin("{ shop { name } }")).status).toBe(401);
    expect((await admin("{ shop { name } }")).status).toBe(200);
    expect(
      (await admin("{ shop { name } }", undefined, "shpat_unknown")).status
    ).toBe(401);
  });
});
