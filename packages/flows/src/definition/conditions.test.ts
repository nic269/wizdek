import { describe, expect, it } from "vitest";
import {
  ConditionError,
  combineConditions,
  evaluateCondition,
  toNumber,
} from "./conditions";

describe("toNumber", () => {
  it("reads amounts with currency symbols and thousands separators", () => {
    expect(toNumber(1250)).toBe(1250);
    expect(toNumber("1250.50")).toBe(1250.5);
    expect(toNumber("$1,250.50")).toBe(1250.5);
    expect(toNumber("1,000,000")).toBe(1_000_000);
    expect(toNumber("USD 99")).toBe(99);
    expect(toNumber("-12.5 €")).toBe(-12.5);
  });

  it("refuses values that are not numbers", () => {
    for (const value of [
      "",
      "abc",
      "12.3.4",
      "1-2",
      null,
      undefined,
      {},
      Number.NaN,
    ]) {
      expect(() => toNumber(value)).toThrow(ConditionError);
    }
  });
});

describe("evaluateCondition", () => {
  const number = (left: unknown, operator: string, right: unknown) =>
    evaluateCondition({
      left,
      operator: operator as never,
      right,
      valueType: "number",
    });
  const text = (left: unknown, operator: string, right?: unknown) =>
    evaluateCondition({
      left,
      operator: operator as never,
      right,
      valueType: "string",
    });

  it("compares numbers numerically, not as text", () => {
    expect(number("1,250.00", "gt", "1000")).toBe(true);
    expect(number("999.99", "gt", 1000)).toBe(false);
    expect(number("9", "lt", "10")).toBe(true);
    expect(number("1000", "gte", "$1,000")).toBe(true);
    expect(number("1000", "lte", 999)).toBe(false);
    expect(number("10.0", "eq", "10")).toBe(true);
    expect(number("10", "neq", "10.5")).toBe(true);
  });

  it("fails a numeric comparison on a non-number", () => {
    expect(() => number("n/a", "gt", "1000")).toThrow("is not a number");
  });

  it("compares and searches text", () => {
    expect(text("paid", "eq", "paid")).toBe(true);
    expect(text("9", "lt", "10")).toBe(false);
    expect(text("high-value order", "contains", "value")).toBe(true);
    expect(text("#1001", "startsWith", "#")).toBe(true);
    expect(text("a@example.com", "endsWith", "@example.org")).toBe(false);
    expect(text(42, "contains", "4")).toBe(true);
  });

  it("checks emptiness without a right-hand value", () => {
    expect(text("  ", "isEmpty")).toBe(true);
    expect(text(undefined, "isEmpty")).toBe(true);
    expect(text([], "isEmpty")).toBe(true);
    expect(text(0, "isEmpty")).toBe(false);
    expect(text("x", "isNotEmpty")).toBe(true);
    expect(text(null, "isNotEmpty")).toBe(false);
  });
});

describe("combineConditions", () => {
  it("requires all or any", () => {
    expect(combineConditions("all", [true, true])).toBe(true);
    expect(combineConditions("all", [true, false])).toBe(false);
    expect(combineConditions("any", [false, true])).toBe(true);
    expect(combineConditions("any", [false, false])).toBe(false);
  });
});
