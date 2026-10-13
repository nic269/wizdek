import { MAIN_OUTPUT } from "../definition/node-spec";
import { triggerWebhookSpec } from "../definition/specs/trigger-webhook";
import { defineNode } from "../registry/define-node";

/** Passes the webhook payload on as the run's single item. */
export const triggerWebhookNode = defineNode(triggerWebhookSpec, ({ item }) =>
  Promise.resolve({ outputs: [{ handle: MAIN_OUTPUT, json: item.json }] })
);
