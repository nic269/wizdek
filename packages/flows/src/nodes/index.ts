import type { AnyNodeDefinition } from "../registry/define-node";
import { createNodeRegistry } from "../registry/registry";
import { dataParseCsvNode } from "./data-parse-csv";
import { logicIfNode } from "./logic-if";
import { shopifyAddTagsNode } from "./shopify-add-tags";
import { shopifyFindOrderNode } from "./shopify-find-order";
import { triggerManualNode } from "./trigger-manual";

export const builtInNodes: readonly AnyNodeDefinition[] = [
  triggerManualNode,
  dataParseCsvNode,
  logicIfNode,
  shopifyFindOrderNode,
  shopifyAddTagsNode,
];

/** The registry used in production. Tests may build their own. */
export const builtInRegistry = createNodeRegistry(builtInNodes);
