import { classifyOperation } from "@repo/shopify/graphql/classify-operation";
import { shopifyFetchCustomersSpec } from "../definition/specs/shopify-fetch-customers";
import { assertItemSize } from "../engine/item-store";
import {
  defineNode,
  FlowItemError,
  type NodeOutput,
} from "../registry/define-node";

interface CustomerCheckpoint {
  after: string | null;
  bytes: number;
  customers: number;
  done: boolean;
  pages: number;
}

export const shopifyFetchCustomersNode = defineNode(
  shopifyFetchCustomersSpec,
  async ({ config, ctx, item }) => {
    const document = `query ExportCustomers($after: String, $first: Int!, $query: String, $sortKey: CustomerSortKeys) {
    customers(first: $first, after: $after, query: $query, sortKey: $sortKey) {
      nodes { ${config.fields} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
    if (classifyOperation(document).type !== "query") {
      throw new FlowItemError("Only customer field selections are allowed.");
    }
    const storage = ctx.storage.checkpoints;
    if (!storage) {
      throw new FlowItemError("Customer checkpoint storage is unavailable.");
    }
    const stateKey = `customers:${item.key}`;
    let progress = (await ctx.stepState.get<CustomerCheckpoint>(stateKey)) ?? {
      after: null,
      bytes: 0,
      customers: 0,
      done: false,
      pages: 0,
    };
    while (!progress.done) {
      ctx.signal.throwIfAborted();
      const data: {
        customers: {
          nodes: Record<string, unknown>[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await ctx.shopify.request(document, {
        after: progress.after,
        first: config.pageSize,
        query: String(ctx.resolve(config.query, item) ?? ""),
        sortKey: config.sortKey,
      });
      const { nodes, pageInfo } = data.customers;
      const json = { rows: nodes };
      assertItemSize(json);
      const bytes = progress.bytes + Buffer.byteLength(JSON.stringify(json));
      if (bytes > 50_000_000) {
        throw new FlowItemError(
          "Customer export exceeds 50 MB. Narrow the search or select fewer fields."
        );
      }
      if (
        pageInfo.hasNextPage &&
        (!pageInfo.endCursor || pageInfo.endCursor === progress.after)
      ) {
        throw new FlowItemError("Shopify did not advance the customer cursor.");
      }
      // Persist data before advancing the cursor. An interrupted write is retried
      // at the same page key and cannot add a duplicate page to the output.
      await storage.write(`${stateKey}:${progress.pages}`, json);
      const next = {
        after: pageInfo.endCursor,
        bytes,
        customers: progress.customers + nodes.length,
        done: !pageInfo.hasNextPage,
        pages: progress.pages + 1,
      };
      await ctx.stepState.set(stateKey, next);
      progress = next;
      ctx.logger.info("Customer batch checkpoint saved", {
        customers: progress.customers,
        pages: progress.pages,
      });
    }
    const outputs: NodeOutput[] = [];
    for (let index = 0; index < progress.pages; index += 1) {
      ctx.signal.throwIfAborted();
      outputs.push({
        handle: "main",
        json: await storage.read(`${stateKey}:${index}`),
      });
    }
    return { outputs };
  }
);
