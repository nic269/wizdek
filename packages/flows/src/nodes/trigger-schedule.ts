import { MAIN_OUTPUT } from "../definition/node-spec";
import { triggerScheduleSpec } from "../definition/specs/trigger-schedule";
import { defineNode } from "../registry/define-node";

/** Passes the scheduled time on as the run's single item. */
export const triggerScheduleNode = defineNode(triggerScheduleSpec, ({ item }) =>
  Promise.resolve({ outputs: [{ handle: MAIN_OUTPUT, json: item.json }] })
);
