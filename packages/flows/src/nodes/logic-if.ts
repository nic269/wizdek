import {
  ConditionError,
  combineConditions,
  evaluateCondition,
  UNARY_OPERATORS,
} from "../definition/conditions";
import {
  IF_FALSE_OUTPUT,
  IF_TRUE_OUTPUT,
  logicIfSpec,
} from "../definition/specs/logic-if";
import { defineNode, FlowItemError } from "../registry/define-node";

/** Routes each item to the true or false output. */
export const logicIfNode = defineNode(logicIfSpec, ({ config, ctx, item }) => {
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
    const passed = combineConditions(config.combinator, results);
    return Promise.resolve({
      outputs: [
        { handle: passed ? IF_TRUE_OUTPUT : IF_FALSE_OUTPUT, json: item.json },
      ],
    });
  } catch (error) {
    if (error instanceof ConditionError) {
      return Promise.reject(new FlowItemError(error.message));
    }
    return Promise.reject(error);
  }
});
