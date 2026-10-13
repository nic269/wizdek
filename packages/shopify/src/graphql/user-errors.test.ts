import { describe, expect, it } from "vitest";
import { countGraphqlErrors, countUserErrors } from "./user-errors";

describe("countUserErrors", () => {
  it("sums user errors across every mutation payload", () => {
    expect(
      countUserErrors({
        data: {
          customerCreate: { customerUserErrors: [{ message: "taken" }] },
          second: { userErrors: [] },
          tagsAdd: {
            node: null,
            userErrors: [{ message: "a" }, { message: "b" }],
          },
        },
      })
    ).toBe(3);
  });

  it("ignores lookalike keys, non-arrays and nested data", () => {
    expect(
      countUserErrors({
        data: {
          order: {
            abuserErrors: [1],
            nested: { userErrors: [1] },
            userErrors: "none",
          },
          shop: null,
        },
      })
    ).toBe(0);
    expect(countUserErrors({ errors: [] })).toBe(0);
    expect(countUserErrors(null)).toBe(0);
  });
});

describe("countGraphqlErrors", () => {
  it("counts list entries and treats a string error as one", () => {
    expect(countGraphqlErrors({ errors: [{}, {}] })).toBe(2);
    expect(countGraphqlErrors({ errors: "[API] Invalid API key" })).toBe(1);
    expect(countGraphqlErrors({ data: {} })).toBe(0);
    expect(countGraphqlErrors("nope")).toBe(0);
  });
});
