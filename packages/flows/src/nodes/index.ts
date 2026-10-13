import type { AnyNodeDefinition } from "../registry/define-node";
import { createNodeRegistry } from "../registry/registry";
import { dataParseCsvNode } from "./data-parse-csv";
import { dataSetFieldsNode } from "./data-set-fields";
import { logicFilterNode } from "./logic-filter";
import { logicIfNode } from "./logic-if";
import { logicSwitchNode } from "./logic-switch";
import { shopifyAddTagsNode } from "./shopify-add-tags";
import { shopifyBulkMutationNode } from "./shopify-bulk-mutation";
import { shopifyFindOrderNode } from "./shopify-find-order";
import { shopifyGraphqlNode } from "./shopify-graphql";
import { triggerManualNode } from "./trigger-manual";
import { triggerScheduleNode } from "./trigger-schedule";
import { triggerWebhookNode } from "./trigger-webhook";

export const builtInNodes: readonly AnyNodeDefinition[] = [
  triggerManualNode,
  triggerWebhookNode,
  triggerScheduleNode,
  dataParseCsvNode,
  dataSetFieldsNode,
  logicIfNode,
  logicFilterNode,
  logicSwitchNode,
  shopifyFindOrderNode,
  shopifyAddTagsNode,
  shopifyGraphqlNode,
  shopifyBulkMutationNode,
];

/** The registry used in production. Tests may build their own. */
export const builtInRegistry = createNodeRegistry(builtInNodes);
