import type { AnyNodeDefinition } from "../registry/define-node";
import { createNodeRegistry } from "../registry/registry";
import { dataParseCsvNode } from "./data-parse-csv";
import { logicIfNode } from "./logic-if";
import { shopifyAddTagsNode } from "./shopify-add-tags";
import { shopifyFindOrderNode } from "./shopify-find-order";
import { triggerManualNode } from "./trigger-manual";
import { triggerScheduleNode } from "./trigger-schedule";
import { triggerWebhookNode } from "./trigger-webhook";

export const builtInNodes: readonly AnyNodeDefinition[] = [
  triggerManualNode,
  triggerWebhookNode,
  triggerScheduleNode,
  dataParseCsvNode,
  logicIfNode,
  shopifyFindOrderNode,
  shopifyAddTagsNode,
];

/** The registry used in production. Tests may build their own. */
export const builtInRegistry = createNodeRegistry(builtInNodes);
