import { describe, expect, it, vi } from "vitest";
import { resolveTemplate } from "../definition/template";
import {
  type FlowItem,
  FlowItemError,
  type NodeContext,
} from "../registry/define-node";
import { dataParseCsvNode } from "./data-parse-csv";
import { logicIfNode } from "./logic-if";
import { shopifyAddTagsNode } from "./shopify-add-tags";
import { orderNameSearch, shopifyFindOrderNode } from "./shopify-find-order";
import { triggerManualNode } from "./trigger-manual";

const createContext = (overrides: Partial<NodeContext> = {}): NodeContext => ({
  logger: { info: vi.fn(), warn: vi.fn() },
  resolve: (template, current) =>
    resolveTemplate(template, { json: current.json, run: {}, trigger: {} }),
  run: {
    flowId: "flow-1",
    id: "run-1",
    organizationId: "org-1",
    storeId: "store-1",
    triggerType: "manual",
  },
  shopify: { request: vi.fn() },
  signal: new AbortController().signal,
  stepState: { get: vi.fn(), set: vi.fn() },
  storage: { readAsset: vi.fn() },
  store: {
    apiVersion: "2026-07",
    currencyCode: "USD",
    id: "store-1",
    name: "Store",
    shopDomain: "store.myshopify.com",
  },
  ...overrides,
});

const item = (json: Record<string, unknown>, key = "0"): FlowItem => ({
  json,
  key,
});

const csvContext = (text: string) =>
  createContext({
    storage: {
      readAsset: vi.fn(async () => ({
        body: new TextEncoder().encode(text),
        contentType: "text/csv",
        fileName: "orders.csv",
      })),
    },
  });

const parseCsv = (text: string, config: Record<string, unknown> = {}) =>
  dataParseCsvNode.execute({
    config: dataParseCsvNode.configSchema.parse({
      file: "{{ $json.csvFile }}",
      ...config,
    }),
    ctx: csvContext(text),
    item: item({ csvFile: "asset-1" }),
  });

describe("trigger.manual", () => {
  it("passes the run inputs on as one item", async () => {
    await expect(
      triggerManualNode.execute({
        config: { inputs: [] },
        ctx: createContext(),
        item: item({ csvFile: "asset-1" }),
      })
    ).resolves.toEqual({
      outputs: [{ handle: "main", json: { csvFile: "asset-1" } }],
    });
  });
});

describe("data.parseCsv", () => {
  it("emits one item per row keyed by header, with the spreadsheet row number", async () => {
    const { outputs } = await parseCsv(
      '﻿Order,Total\n#1001,"1,250.00"\n\n #1002 , 80 \n'
    );

    expect(outputs.map(({ json }) => json)).toEqual([
      { $row: 2, Order: "#1001", Total: "1,250.00" },
      { $row: 3, Order: "#1002", Total: "80" },
    ]);
  });

  it("supports files without a header and other delimiters", async () => {
    const { outputs } = await parseCsv("#1001;50\n#1002;60\n", {
      delimiter: ";",
      hasHeader: false,
    });

    expect(outputs.map(({ json }) => json)).toEqual([
      { $row: 1, column1: "#1001", column2: "50" },
      { $row: 2, column1: "#1002", column2: "60" },
    ]);
  });

  it("fails the item on malformed CSV or a missing file reference", async () => {
    await expect(parseCsv('Order,Total\n"#1001,50\n')).rejects.toThrow(
      FlowItemError
    );
    await expect(
      dataParseCsvNode.execute({
        config: dataParseCsvNode.configSchema.parse({
          file: "{{ $json.nope }}",
        }),
        ctx: csvContext("Order\n"),
        item: item({}),
      })
    ).rejects.toThrow("did not resolve to an uploaded file");
  });
});

describe("logic.if", () => {
  const route = async (
    json: Record<string, unknown>,
    config: Record<string, unknown>
  ) => {
    const { outputs } = await logicIfNode.execute({
      config: logicIfNode.configSchema.parse(config),
      ctx: createContext(),
      item: item(json),
    });
    return outputs[0]?.handle;
  };
  const totalAbove1000 = {
    conditions: [
      {
        left: "{{ $json.Total }}",
        operator: "gt",
        right: "1000",
        valueType: "number",
      },
    ],
  };

  it("routes by a numeric comparison that tolerates formatted amounts", async () => {
    await expect(route({ Total: "$1,250.00" }, totalAbove1000)).resolves.toBe(
      "true"
    );
    await expect(route({ Total: "999.99" }, totalAbove1000)).resolves.toBe(
      "false"
    );
    await expect(route({ Total: 1000 }, totalAbove1000)).resolves.toBe("false");
  });

  it("fails the item when a number is expected and absent", async () => {
    await expect(route({ Total: "n/a" }, totalAbove1000)).rejects.toThrow(
      '"n/a" is not a number.'
    );
    await expect(route({}, totalAbove1000)).rejects.toThrow(FlowItemError);
  });

  it("combines several conditions with all or any", async () => {
    const conditions = [
      { left: "{{ $json.country }}", operator: "eq", right: "VN" },
      { left: "{{ $json.note }}", operator: "isNotEmpty" },
    ];
    const json = { country: "VN", note: "" };

    await expect(route(json, { combinator: "all", conditions })).resolves.toBe(
      "false"
    );
    await expect(route(json, { combinator: "any", conditions })).resolves.toBe(
      "true"
    );
  });
});

describe("shopify.findOrder", () => {
  const order = {
    id: "gid://shopify/Order/1",
    name: "#1001",
    tags: ["vip"],
    totalPriceSet: { shopMoney: { amount: "1250.00", currencyCode: "USD" } },
  };

  it("quotes and escapes the order name in the search value", () => {
    expect(orderNameSearch("#1001")).toBe('name:"#1001"');
    expect(orderNameSearch('x" OR name:*')).toBe('name:"x\\" OR name:*"');
    expect(orderNameSearch("a\\b")).toBe('name:"a\\\\b"');
  });

  it("looks up by name through a variable and adds the order to the item", async () => {
    const request = vi.fn(async () => ({
      orders: { nodes: [{ ...order, name: "#10011" }, order] },
    }));

    const { outputs } = await shopifyFindOrderNode.execute({
      config: shopifyFindOrderNode.configSchema.parse({
        value: "{{ $json.Order }}",
      }),
      ctx: createContext({ shopify: { request } as NodeContext["shopify"] }),
      item: item({ Order: " #1001 " }),
    });

    const [query, variables] = request.mock.calls[0] as unknown as [
      string,
      unknown,
    ];
    expect(query).not.toContain("#1001");
    expect(variables).toEqual({ query: 'name:"#1001"' });
    expect(outputs[0]?.json).toEqual({
      Order: " #1001 ",
      order: {
        currencyCode: "USD",
        id: "gid://shopify/Order/1",
        name: "#1001",
        tags: ["vip"],
        totalPrice: "1250.00",
      },
    });
  });

  it("accepts a numeric id and fails the item when nothing matches", async () => {
    const request = vi.fn(async () => ({ order: null }));
    const run = (json: Record<string, unknown>) =>
      shopifyFindOrderNode.execute({
        config: shopifyFindOrderNode.configSchema.parse({
          by: "id",
          value: "{{ $json.id }}",
        }),
        ctx: createContext({ shopify: { request } as NodeContext["shopify"] }),
        item: item(json),
      });

    await expect(run({ id: 42 })).rejects.toThrow('No order found for "42".');
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      id: "gid://shopify/Order/42",
    });
    await expect(run({})).rejects.toThrow("The order to look up is empty");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("shopify.addTags", () => {
  const execute = (
    request: NodeContext["shopify"]["request"],
    json: Record<string, unknown>
  ) =>
    shopifyAddTagsNode.execute({
      config: shopifyAddTagsNode.configSchema.parse({
        resourceId: "{{ $json.order.id }}",
        tags: ["high-value", "{{ $json.Region }}"],
      }),
      ctx: createContext({ shopify: { request } }),
      item: item(json),
    });

  it("sends resolved tags as variables and records them on the item", async () => {
    const request = vi.fn(async () => ({
      tagsAdd: { node: { id: "gid://shopify/Order/1" }, userErrors: [] },
    })) as unknown as NodeContext["shopify"]["request"];

    const { outputs } = await execute(request, {
      order: { id: "gid://shopify/Order/1" },
      Region: "apac",
    });

    expect(request).toHaveBeenCalledWith(expect.any(String), {
      id: "gid://shopify/Order/1",
      tags: ["high-value", "apac"],
    });
    expect(outputs[0]?.json.tagsAdded).toEqual(["high-value", "apac"]);
  });

  it("fails the item on user errors or a missing resource", async () => {
    const rejecting = vi.fn(async () => ({
      tagsAdd: {
        node: null,
        userErrors: [{ field: ["id"], message: "Order does not exist" }],
      },
    })) as unknown as NodeContext["shopify"]["request"];

    await expect(
      execute(rejecting, { order: { id: "gid://shopify/Order/404" } })
    ).rejects.toThrow("Order does not exist");
    await expect(execute(rejecting, {})).rejects.toThrow(
      "The resource to tag is empty"
    );
    expect(rejecting).toHaveBeenCalledTimes(1);
  });
});
