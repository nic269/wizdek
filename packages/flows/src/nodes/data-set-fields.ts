import { ConditionError, toNumber } from "../definition/conditions";
import { MAIN_OUTPUT } from "../definition/node-spec";
import { dataSetFieldsSpec } from "../definition/specs/data-set-fields";
import { defineNode, FlowItemError } from "../registry/define-node";

const TRUE_WORDS = new Set(["true", "yes", "1", "y"]);
const FALSE_WORDS = new Set(["false", "no", "0", "n", ""]);

const toText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  const word = toText(value).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) {
    return true;
  }
  if (FALSE_WORDS.has(word)) {
    return false;
  }
  throw new FlowItemError(`"${toText(value)}" is not a yes or no value.`);
};

const coerce = (
  value: unknown,
  type: "auto" | "string" | "number" | "boolean"
) => {
  if (type === "string") {
    return toText(value);
  }
  if (type === "boolean") {
    return toBoolean(value);
  }
  if (type === "number") {
    try {
      return toNumber(value);
    } catch (error) {
      throw error instanceof ConditionError
        ? new FlowItemError(error.message)
        : error;
    }
  }
  // "auto" keeps whatever the template resolved to; missing becomes null.
  return value === undefined ? null : value;
};

/** Renames, then sets, then removes fields, and passes the item on. */
export const dataSetFieldsNode = defineNode(
  dataSetFieldsSpec,
  ({ config, ctx, item }) => {
    try {
      const json: Record<string, unknown> = { ...item.json };
      for (const { from, to } of config.rename) {
        if (Object.hasOwn(json, from)) {
          json[to] = json[from];
          delete json[from];
        }
      }
      for (const field of config.set) {
        // Values are resolved against the item as it arrived.
        json[field.name] = coerce(ctx.resolve(field.value, item), field.type);
      }
      for (const name of config.remove) {
        delete json[name];
      }
      return Promise.resolve({ outputs: [{ handle: MAIN_OUTPUT, json }] });
    } catch (error) {
      return Promise.reject(error);
    }
  }
);
