"use client";

import { Button } from "@repo/design-system";
import {
  CONDITION_OPERATORS,
  type ConditionOperator,
  UNARY_OPERATORS,
} from "@repo/flows/definition";
import { TemplateInput } from "../template-input";
import {
  asArray,
  asString,
  type ConfigFormProps,
  Field,
  removeAt,
  replaceAt,
  selectClassName,
} from "./form-parts";

interface ConditionRow {
  left: string;
  operator: ConditionOperator;
  right: string;
  valueType: "string" | "number";
}

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  contains: "contains",
  endsWith: "ends with",
  eq: "equals",
  gt: "is greater than",
  gte: "is at least",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  lt: "is less than",
  lte: "is at most",
  neq: "does not equal",
  startsWith: "starts with",
};

const EMPTY_ROW: ConditionRow = {
  left: "",
  operator: "eq",
  right: "",
  valueType: "string",
};

export function IfForm({
  config,
  disabled,
  heading = "Send the item to “true” when",
  onChange,
  sampleFields,
}: ConfigFormProps & { heading?: string }) {
  const conditions = asArray<ConditionRow>(config.conditions);
  const setConditions = (next: ConditionRow[]) =>
    onChange({ ...config, conditions: next });
  const update = (index: number, patch: Partial<ConditionRow>) =>
    setConditions(
      replaceAt(conditions, index, {
        ...(conditions[index] ?? EMPTY_ROW),
        ...patch,
      })
    );

  return (
    <div className="space-y-4">
      <Field label={heading}>
        <select
          aria-label="Combinator"
          className={selectClassName}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...config, combinator: event.target.value })
          }
          value={asString(config.combinator, "all")}
        >
          <option value="all">all conditions match</option>
          <option value="any">any condition matches</option>
        </select>
      </Field>
      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div
            className="space-y-2 rounded-md border p-2"
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            key={index}
          >
            <TemplateInput
              disabled={disabled}
              label={`Condition ${index + 1} value`}
              onChange={(left) => update(index, { left })}
              placeholder="{{ $json.Total }}"
              sampleFields={sampleFields}
              value={condition.left}
            />
            <div className="flex gap-2">
              <select
                aria-label={`Condition ${index + 1} operator`}
                className={selectClassName}
                disabled={disabled}
                onChange={(event) =>
                  update(index, {
                    operator: event.target.value as ConditionOperator,
                  })
                }
                value={condition.operator}
              >
                {CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {OPERATOR_LABELS[operator]}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Condition ${index + 1} compare as`}
                className={selectClassName}
                disabled={disabled}
                onChange={(event) =>
                  update(index, {
                    valueType: event.target.value as ConditionRow["valueType"],
                  })
                }
                value={condition.valueType}
              >
                <option value="string">as text</option>
                <option value="number">as number</option>
              </select>
            </div>
            {UNARY_OPERATORS.has(condition.operator) ? null : (
              <TemplateInput
                disabled={disabled}
                label={`Condition ${index + 1} compared with`}
                onChange={(right) => update(index, { right })}
                placeholder="1000"
                value={condition.right}
              />
            )}
            <Button
              disabled={disabled || conditions.length === 1}
              onClick={() => setConditions(removeAt(conditions, index))}
              size="sm"
              type="button"
              variant="ghost"
            >
              Remove condition
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled}
          onClick={() => setConditions([...conditions, EMPTY_ROW])}
          size="sm"
          type="button"
          variant="outline"
        >
          Add condition
        </Button>
      </div>
    </div>
  );
}

/** The filter step uses the same conditions; matching items are kept. */
export function FilterForm(props: ConfigFormProps) {
  return <IfForm {...props} heading="Keep the item when" />;
}
