import { describe, expect, it, vi } from "vitest";
import { resolveIdempotent, resolveOutputs } from "../definition/node-spec";
import { resolveTemplate } from "../definition/template";
import {
  FlowFatalError,
  type FlowItem,
  FlowItemError,
  type NodeContext,
} from "../registry/define-node";
import { dataSetFieldsNode } from "./data-set-fields";
import { logicFilterNode } from "./logic-filter";
import { logicSwitchNode } from "./logic-switch";
import { shopifyGraphqlNode } from "./shopify-graphql";

const createContext = (
  request: NodeContext["shopify"]["request"] = vi.fn()
): NodeContext => ({
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
  shopify: { request },
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
});

const item = (json: Record<string, unknown>): FlowItem => ({ json, key: "0" });

describe("logic.filter", () => {
  const filter = (json: Record<string, unknown>) =>
    logicFilterNode.execute({
      config: logicFilterNode.configSchema.parse({
        conditions: [
          {
            left: "{{ $json.Total }}",
            operator: "gte",
            right: "100",
            valueType: "number",
          },
        ],
      }),
      ctx: createContext(),
      item: item(json),
    });

  it("passes matching items on and drops the rest", async () => {
    await expect(filter({ Total: "250" })).resolves.toEqual({
      outputs: [{ handle: "main", json: { Total: "250" } }],
    });
    await expect(filter({ Total: "99.99" })).resolves.toEqual({ outputs: [] });
  });

  it("fails the item when the value cannot be compared", async () => {
    await expect(filter({ Total: "unknown" })).rejects.toThrow(FlowItemError);
  });
});

describe("logic.switch", () => {
  const config = logicSwitchNode.configSchema.parse({
    cases: [
      { name: "vietnam", value: "VN" },
      { name: "japan", value: "JP" },
    ],
    value: "{{ $json.country }}",
  });
  const route = async (json: Record<string, unknown>) =>
    (
      await logicSwitchNode.execute({
        config,
        ctx: createContext(),
        item: item(json),
      })
    ).outputs[0]?.handle;

  it("derives its outputs from the cases, plus default", () => {
    expect(resolveOutputs(logicSwitchNode, config)).toEqual([
      "vietnam",
      "japan",
      "default",
    ]);
  });

  it("routes each item to the matching case or to default", async () => {
    await expect(route({ country: "VN" })).resolves.toBe("vietnam");
    await expect(route({ country: " JP " })).resolves.toBe("japan");
    await expect(route({ country: "US" })).resolves.toBe("default");
    await expect(route({})).resolves.toBe("default");
  });

  it("rejects duplicate case names and the reserved name", () => {
    const parse = (cases: { name: string; value: string }[]) =>
      logicSwitchNode.configSchema.safeParse({ cases, value: "{{ $json.x }}" })
        .success;

    expect(
      parse([
        { name: "a", value: "1" },
        { name: "a", value: "2" },
      ])
    ).toBe(false);
    expect(parse([{ name: "default", value: "1" }])).toBe(false);
    expect(parse([])).toBe(false);
  });
});

describe("data.setFields", () => {
  const apply = (
    json: Record<string, unknown>,
    config: Record<string, unknown>
  ) =>
    dataSetFieldsNode.execute({
      config: dataSetFieldsNode.configSchema.parse(config),
      ctx: createContext(),
      item: item(json),
    });

  it("renames, sets with coercion and removes, in that order", async () => {
    const { outputs } = await apply(
      { note: "x", "Order Name": "#1001", Total: "$1,250.50", vip: "yes" },
      {
        remove: ["note"],
        rename: [{ from: "Order Name", to: "order" }],
        set: [
          { name: "total", type: "number", value: "{{ $json.Total }}" },
          { name: "isVip", type: "boolean", value: "{{ $json.vip }}" },
          {
            name: "label",
            type: "string",
            value: 'Order {{ $json["Order Name"] }}',
          },
          { name: "raw", value: "{{ $json.Total }}" },
          { name: "missing", value: "{{ $json.nothing }}" },
        ],
      }
    );

    expect(outputs[0]?.json).toEqual({
      isVip: true,
      label: "Order #1001",
      missing: null,
      order: "#1001",
      raw: "$1,250.50",
      Total: "$1,250.50",
      total: 1250.5,
      vip: "yes",
    });
  });

  it("fails the item on a value that cannot be coerced", async () => {
    await expect(
      apply(
        { Total: "n/a" },
        { set: [{ name: "t", type: "number", value: "{{ $json.Total }}" }] }
      )
    ).rejects.toThrow(FlowItemError);
    await expect(
      apply(
        { flag: "maybe" },
        { set: [{ name: "f", type: "boolean", value: "{{ $json.flag }}" }] }
      )
    ).rejects.toThrow("is not a yes or no value");
  });

  it("refuses field names that reach object internals", () => {
    expect(
      dataSetFieldsNode.configSchema.safeParse({
        set: [{ name: "__proto__", value: "x" }],
      }).success
    ).toBe(false);
  });
});

describe("shopify.graphql", () => {
  const MUTATION =
    "mutation Note($id: ID!, $note: String) { orderUpdate(input: { id: $id, note: $note }) { order { id note } userErrors { field message } } }";
  const execute = (
    request: NodeContext["shopify"]["request"],
    config: Record<string, unknown>,
    json: Record<string, unknown> = { id: "gid://shopify/Order/1", note: "hi" }
  ) =>
    shopifyGraphqlNode.execute({
      config: shopifyGraphqlNode.configSchema.parse(config),
      ctx: createContext(request),
      item: item(json),
    });

  it("is repeatable for a query and not for anything that may mutate", () => {
    const idempotent = (document: string) =>
      resolveIdempotent(
        shopifyGraphqlNode,
        shopifyGraphqlNode.configSchema.parse({ document })
      );

    expect(idempotent("{ shop { name } }")).toBe(true);
    expect(idempotent("query Shop { shop { name } }")).toBe(true);
    expect(idempotent(MUTATION)).toBe(false);
    expect(
      idempotent("# note\nfragment F on Order { id }\nmutation M { x }")
    ).toBe(false);
  });

  it("resolves templates inside the variables and reads the result path", async () => {
    const request = vi.fn(async () => ({
      orderUpdate: {
        order: { id: "gid://shopify/Order/1", note: "hi" },
        userErrors: [],
      },
    })) as unknown as NodeContext["shopify"]["request"];

    const { outputs } = await execute(request, {
      document: MUTATION,
      resultPath: "orderUpdate.order",
      variables:
        '{"id":"{{ $json.id }}","note":"Note: {{ $json.note }}","nested":{"list":["{{ $json.note }}",3]}}',
    });

    expect(request).toHaveBeenCalledWith(MUTATION, {
      id: "gid://shopify/Order/1",
      nested: { list: ["hi", 3] },
      note: "Note: hi",
    });
    expect(outputs[0]?.json.result).toEqual({
      id: "gid://shopify/Order/1",
      note: "hi",
    });
  });

  it("fails the item on user errors, naming the field", async () => {
    const request = vi.fn(async () => ({
      orderUpdate: {
        order: null,
        userErrors: [
          { field: ["input", "id"], message: "Order does not exist" },
        ],
      },
    })) as unknown as NodeContext["shopify"]["request"];

    await expect(execute(request, { document: MUTATION })).rejects.toThrow(
      "input.id: Order does not exist"
    );
  });

  it("refuses subscriptions, several operations and invalid documents before sending", async () => {
    const request = vi.fn() as unknown as NodeContext["shopify"]["request"];
    for (const document of [
      "subscription { orderCreated { id } }",
      "query A { shop { name } } query B { shop { id } }",
      "query {",
    ]) {
      await expect(execute(request, { document })).rejects.toThrow(
        FlowFatalError
      );
    }
    expect(request).not.toHaveBeenCalled();
    expect(
      shopifyGraphqlNode.configSchema.safeParse({
        document: "{ a }",
        variables: "[1]",
      }).success
    ).toBe(false);
  });
});
