export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startsWith",
  "endsWith",
  "isEmpty",
  "isNotEmpty",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export type ConditionValueType = "string" | "number";

export const UNARY_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "isEmpty",
  "isNotEmpty",
]);

export class ConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionError";
  }
}

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const NUMBER_NOISE = /[^\d.,-]/g;
const THOUSANDS_SEPARATOR = /,/g;

const describe = (value: unknown) =>
  typeof value === "string" ? `"${value}"` : String(value);

/**
 * Reads a number the way spreadsheets export amounts: currency symbols and
 * codes are ignored and commas are treated as thousands separators.
 */
export const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value
      .replace(NUMBER_NOISE, "")
      .replace(THOUSANDS_SEPARATOR, "");
    if (NUMBER_PATTERN.test(cleaned)) {
      return Number(cleaned);
    }
  }
  throw new ConditionError(`${describe(value)} is not a number.`);
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const compare = <T extends string | number>(
  operator: ConditionOperator,
  left: T,
  right: T
): boolean => {
  switch (operator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      throw new ConditionError(`Operator ${operator} cannot compare values.`);
  }
};

const TEXT_OPERATORS = {
  contains: (left: string, right: string) => left.includes(right),
  endsWith: (left: string, right: string) => left.endsWith(right),
  startsWith: (left: string, right: string) => left.startsWith(right),
} as const;

export interface Condition {
  left: unknown;
  operator: ConditionOperator;
  right?: unknown;
  valueType: ConditionValueType;
}

/** Evaluates one condition on values that have already been resolved. */
export const evaluateCondition = (condition: Condition): boolean => {
  const { left, operator, right, valueType } = condition;
  if (operator === "isEmpty") {
    return isEmpty(left);
  }
  if (operator === "isNotEmpty") {
    return !isEmpty(left);
  }
  if (operator in TEXT_OPERATORS) {
    return TEXT_OPERATORS[operator as keyof typeof TEXT_OPERATORS](
      toText(left),
      toText(right)
    );
  }
  return valueType === "number"
    ? compare(operator, toNumber(left), toNumber(right))
    : compare(operator, toText(left), toText(right));
};

export const combineConditions = (
  combinator: "all" | "any",
  results: readonly boolean[]
): boolean =>
  combinator === "all" ? results.every(Boolean) : results.some(Boolean);
