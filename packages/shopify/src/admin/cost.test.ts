import { describe, expect, it } from "vitest";
import { parseQueryCost } from "./cost";

describe("parseQueryCost", () => {
  it("reads cost and throttle status from extensions", () => {
    expect(
      parseQueryCost({
        data: {},
        extensions: {
          cost: {
            actualQueryCost: 4,
            requestedQueryCost: 12,
            throttleStatus: {
              currentlyAvailable: 1996,
              maximumAvailable: 2000,
              restoreRate: 100,
            },
          },
        },
      })
    ).toEqual({
      actualQueryCost: 4,
      requestedQueryCost: 12,
      throttleStatus: {
        currentlyAvailable: 1996,
        maximumAvailable: 2000,
        restoreRate: 100,
      },
    });
  });

  it("keeps the per-field breakdown when present", () => {
    const fields = [{ path: ["shop"], requestedTotalCost: 1 }];
    expect(
      parseQueryCost({
        extensions: { cost: { fields, requestedQueryCost: 1 } },
      })
    ).toEqual({ fields, requestedQueryCost: 1 });
  });

  it("returns undefined when there is no cost and drops malformed parts", () => {
    expect(parseQueryCost(null)).toBeUndefined();
    expect(parseQueryCost({ data: {} })).toBeUndefined();
    expect(parseQueryCost({ extensions: { cost: "high" } })).toBeUndefined();
    expect(
      parseQueryCost({
        extensions: {
          cost: {
            requestedQueryCost: "12",
            throttleStatus: { currentlyAvailable: 1 },
          },
        },
      })
    ).toEqual({});
  });
});
