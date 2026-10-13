import type { AnyNodeSpec } from "../node-spec";
import { dataParseCsvSpec } from "./data-parse-csv";
import { dataSetFieldsSpec } from "./data-set-fields";
import { logicFilterSpec } from "./logic-filter";
import { logicIfSpec } from "./logic-if";
import { logicSwitchSpec } from "./logic-switch";
import { shopifyAddTagsSpec } from "./shopify-add-tags";
import { shopifyBulkMutationSpec } from "./shopify-bulk-mutation";
import { shopifyFindOrderSpec } from "./shopify-find-order";
import { shopifyGraphqlSpec } from "./shopify-graphql";
import { triggerManualSpec } from "./trigger-manual";
import { triggerScheduleSpec } from "./trigger-schedule";
import { triggerWebhookSpec } from "./trigger-webhook";

export * from "./data-parse-csv";
export * from "./data-set-fields";
export * from "./logic-filter";
export * from "./logic-if";
export * from "./logic-switch";
export * from "./shopify-add-tags";
export * from "./shopify-bulk-mutation";
export * from "./shopify-find-order";
export * from "./shopify-graphql";
export * from "./trigger-manual";
export * from "./trigger-schedule";
export * from "./trigger-webhook";

/** Every built-in node type, in the order the palette lists them. */
export const builtInNodeSpecs: readonly AnyNodeSpec[] = [
  triggerManualSpec,
  triggerWebhookSpec,
  triggerScheduleSpec,
  dataParseCsvSpec,
  dataSetFieldsSpec,
  logicIfSpec,
  logicFilterSpec,
  logicSwitchSpec,
  shopifyFindOrderSpec,
  shopifyAddTagsSpec,
  shopifyGraphqlSpec,
  shopifyBulkMutationSpec,
];
