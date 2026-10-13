import { MAIN_OUTPUT } from "../definition/node-spec";
import { shopifyFindOrderSpec } from "../definition/specs/shopify-find-order";
import {
  defineNode,
  FlowItemError,
  type NodeContext,
} from "../registry/define-node";

const ORDER_FIELDS = `
  id
  name
  tags
  totalPriceSet { shopMoney { amount currencyCode } }
`;

const FIND_BY_NAME_QUERY = `query FlowFindOrderByName($query: String!) {
  orders(first: 2, query: $query) { nodes { ${ORDER_FIELDS} } }
}`;

const FIND_BY_ID_QUERY = `query FlowFindOrderById($id: ID!) {
  order(id: $id) { ${ORDER_FIELDS} }
}`;

interface OrderNode {
  id: string;
  name: string;
  tags: string[];
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
}

const NUMERIC_ID = /^\d+$/;
const SEARCH_SPECIAL_CHARACTERS = /["\\]/g;

/**
 * Builds the search term for an exact order name. The name is data: it is
 * quoted, with quotes and backslashes escaped, so it cannot add search
 * clauses of its own. It travels as a GraphQL variable, never as query text.
 */
export const orderNameSearch = (name: string): string =>
  `name:"${name.replace(SEARCH_SPECIAL_CHARACTERS, "\\$&")}"`;

const toOrderGid = (value: string): string =>
  NUMERIC_ID.test(value) ? `gid://shopify/Order/${value}` : value;

const toOrder = (order: OrderNode) => ({
  currencyCode: order.totalPriceSet.shopMoney.currencyCode,
  id: order.id,
  name: order.name,
  tags: order.tags,
  totalPrice: order.totalPriceSet.shopMoney.amount,
});

const findById = async (ctx: NodeContext, id: string) => {
  const data = await ctx.shopify.request<{ order: OrderNode | null }>(
    FIND_BY_ID_QUERY,
    { id }
  );
  return data.order;
};

const findByName = async (ctx: NodeContext, name: string) => {
  const data = await ctx.shopify.request<{ orders: { nodes: OrderNode[] } }>(
    FIND_BY_NAME_QUERY,
    { query: orderNameSearch(name) }
  );
  // The search is not guaranteed to be exact, so the name is compared.
  return data.orders.nodes.find((order) => order.name === name);
};

/** Looks an order up by name or id and adds it to the item as `order`. */
export const shopifyFindOrderNode = defineNode(
  shopifyFindOrderSpec,
  async ({ config, ctx, item }) => {
    const resolved = ctx.resolve(config.value, item);
    const value =
      typeof resolved === "string" || typeof resolved === "number"
        ? String(resolved).trim()
        : "";
    if (!value) {
      throw new FlowItemError("The order to look up is empty for this item.");
    }

    const order =
      config.by === "id"
        ? await findById(ctx, toOrderGid(value))
        : await findByName(ctx, value);
    if (!order) {
      throw new FlowItemError(`No order found for "${value}".`);
    }

    return {
      outputs: [
        { handle: MAIN_OUTPUT, json: { ...item.json, order: toOrder(order) } },
      ],
    };
  }
);
