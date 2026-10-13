import type { AnyNodeSpec } from "../node-spec";
import { dataParseCsvSpec } from "./data-parse-csv";
import { logicIfSpec } from "./logic-if";
import { shopifyAddTagsSpec } from "./shopify-add-tags";
import { shopifyFindOrderSpec } from "./shopify-find-order";
import { triggerManualSpec } from "./trigger-manual";
import { triggerScheduleSpec } from "./trigger-schedule";
import { triggerWebhookSpec } from "./trigger-webhook";

export * from "./data-parse-csv";
export * from "./logic-if";
export * from "./shopify-add-tags";
export * from "./shopify-find-order";
export * from "./trigger-manual";
export * from "./trigger-schedule";
export * from "./trigger-webhook";

/** Every built-in node type, in the order the palette lists them. */
export const builtInNodeSpecs: readonly AnyNodeSpec[] = [
  triggerManualSpec,
  triggerWebhookSpec,
  triggerScheduleSpec,
  dataParseCsvSpec,
  logicIfSpec,
  shopifyFindOrderSpec,
  shopifyAddTagsSpec,
];
