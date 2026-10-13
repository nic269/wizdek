import {
  ConditionError,
  combineConditions,
  evaluateCondition,
  UNARY_OPERATORS,
} from "../definition/conditions";
import { MAIN_OUTPUT } from "../definition/node-spec";
import { logicFilterSpec } from "../definition/specs/logic-filter";
import { defineNode, FlowItemError } from "../registry/define-node";

/** Passes matching items on and emits nothing for the others. */
export const logicFilterNode = defineNode(
  logicFilterSpec,
  ({ config, ctx, item }) => {
    try {
      const results = config.conditions.map((condition) =>
        evaluateCondition({
          left: ctx.resolve(condition.left, item),
          operator: condition.operator,
          valueType: condition.valueType,
          ...(UNARY_OPERATORS.has(condition.operator)
            ? {}
            : { right: ctx.resolve(condition.right, item) }),
        })
      );
      return Promise.resolve({
        outputs: combineConditions(config.combinator, results)
          ? [{ handle: MAIN_OUTPUT, json: item.json }]
          : [],
      });
    } catch (error) {
      return Promise.reject(
        error instanceof ConditionError
          ? new FlowItemError(error.message)
          : error
      );
    }
  }
);
