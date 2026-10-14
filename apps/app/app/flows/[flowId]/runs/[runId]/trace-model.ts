import type { FlowDefinition } from "@repo/flows/definition";

type FlowNode = FlowDefinition["nodes"][number];

/**
 * The steps in the order items flow through them: breadth-first from the
 * trigger, siblings left to right as they sit on the canvas. Steps that
 * nothing reaches come last.
 */
export const orderSteps = (definition: FlowDefinition): FlowNode[] => {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const targets = new Set(definition.edges.map(({ target }) => target));
  const queue = definition.nodes
    .filter((node) => !targets.has(node.id))
    .sort((a, b) => a.position.x - b.position.x);
  const seen = new Set<string>();
  const ordered: FlowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    ordered.push(node);
    const next = definition.edges
      .filter(({ source }) => source === node.id)
      .map(({ target }) => byId.get(target))
      .filter((target): target is FlowNode => Boolean(target))
      .sort((a, b) => a.position.y - b.position.y);
    queue.push(...next);
  }
  return [...ordered, ...definition.nodes.filter(({ id }) => !seen.has(id))];
};

/** Adds every node's item counts together. */
export const totalCounts = (
  nodes: Record<string, { counts: Record<string, number> }>
) => {
  const totals: Record<string, number> = {};
  for (const { counts } of Object.values(nodes)) {
    for (const [status, count] of Object.entries(counts)) {
      totals[status] = (totals[status] ?? 0) + count;
    }
  }
  return totals;
};

export const sumOf = (counts: Record<string, number>) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const orderOf = (value: unknown) => asRecord(asRecord(value)?.order);

/** What to call an item: its order's name when it has one, else its key. */
export const itemTitle = (item: {
  input: unknown;
  itemKey: string;
  output: unknown;
}): string => {
  const order = orderOf(item.output) ?? orderOf(item.input);
  if (typeof order?.name === "string") {
    return order.name;
  }
  const input = asRecord(item.input);
  if (input) {
    for (const [key, value] of Object.entries(input)) {
      if (!key.startsWith("$") && typeof value === "string" && value) {
        return value.length > 32 ? `${value.slice(0, 32)}…` : value;
      }
    }
  }
  return item.itemKey;
};

/** The spreadsheet row an item came from, when Parse CSV recorded one. */
export const itemRow = (item: { input: unknown }) => {
  const row = asRecord(item.input)?.$row;
  return typeof row === "number" ? row : null;
};

const ADMIN_PATHS: Record<string, string> = {
  Customer: "customers",
  DraftOrder: "draft_orders",
  Order: "orders",
  Product: "products",
};
const GID = /^gid:\/\/shopify\/(\w+)\/(\d+)$/;

/** The Shopify admin page of the item's order, or null without one. */
export const adminUrl = (
  item: { input: unknown; output: unknown },
  shopDomain: string
): string | null => {
  const order = orderOf(item.output) ?? orderOf(item.input);
  const match = typeof order?.id === "string" ? GID.exec(order.id) : null;
  const path = match ? ADMIN_PATHS[match[1] ?? ""] : undefined;
  if (!(match && path)) {
    return null;
  }
  const store = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/${path}/${match[2]}`;
};

export const errorText = (error: unknown): string | null => {
  const record = asRecord(error);
  if (record && "message" in record) {
    return String(record.message);
  }
  return typeof error === "string" ? error : null;
};
