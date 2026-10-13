import type { AnyNodeSpec } from "../node-spec";
import { dataParseCsvSpec } from "./data-parse-csv";
import { logicIfSpec } from "./logic-if";
import { shopifyAddTagsSpec } from "./shopify-add-tags";
import { shopifyFindOrderSpec } from "./shopify-find-order";
import { triggerManualSpec } from "./trigger-manual";

export * from "./data-parse-csv";
export * from "./logic-if";
export * from "./shopify-add-tags";
export * from "./shopify-find-order";
export * from "./trigger-manual";

/** Every built-in node type, in the order the palette lists them. */
export const builtInNodeSpecs: readonly AnyNodeSpec[] = [
  triggerManualSpec,
  dataParseCsvSpec,
  logicIfSpec,
  shopifyFindOrderSpec,
  shopifyAddTagsSpec,
];
