import {
  logicSwitchSpec,
  SWITCH_DEFAULT_OUTPUT,
} from "../definition/specs/logic-switch";
import { defineNode } from "../registry/define-node";

const toText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

/** Routes each item to the first case whose value it equals. */
export const logicSwitchNode = defineNode(
  logicSwitchSpec,
  ({ config, ctx, item }) => {
    const actual = toText(ctx.resolve(config.value, item)).trim();
    const matched = config.cases.find(
      (entry) => toText(ctx.resolve(entry.value, item)).trim() === actual
    );
    return Promise.resolve({
      outputs: [
        { handle: matched?.name ?? SWITCH_DEFAULT_OUTPUT, json: item.json },
      ],
    });
  }
);
