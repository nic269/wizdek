import { MAIN_OUTPUT } from "../definition/node-spec";
import { triggerManualSpec } from "../definition/specs/trigger-manual";
import { defineNode } from "../registry/define-node";

/** Passes the values the run was started with on as its single item. */
export const triggerManualNode = defineNode(triggerManualSpec, ({ item }) =>
  Promise.resolve({ outputs: [{ handle: MAIN_OUTPUT, json: item.json }] })
);
