import { describe, expect, it } from "vitest";
import { isRetryableTransactionConflict } from "./transaction-conflicts";

describe("isRetryableTransactionConflict", () => {
  it.each([
    { code: "P2034" },
    { cause: { code: "P2034" } },
    {
      meta: {
        driverAdapterError: {
          cause: {
            kind: "TransactionWriteConflict",
            originalCode: "40001",
          },
        },
      },
    },
    {
      cause: {
        code: "40P01",
        kind: "postgres",
        originalCode: "40P01",
      },
    },
  ])("recognizes observed transaction conflict structures", (error) => {
    expect(isRetryableTransactionConflict(error)).toBe(true);
  });

  it.each([
    null,
    "P2034",
    { message: "P2034 TransactionWriteConflict 40001" },
    { code: "40001" },
    { code: "40P01" },
    { kind: "TransactionWriteConflict" },
    { originalCode: "40001" },
    {
      cause: {
        code: "40P01",
        kind: "postgres",
        originalCode: "40001",
      },
    },
    {
      driverAdapterError: {
        cause: {
          kind: "TransactionWriteConflict",
          originalCode: "40001",
        },
      },
    },
    { payload: { code: "P2034" } },
    { meta: { code: "P2034" } },
    { code: "P2002" },
    { kind: "UniqueConstraintViolation" },
  ])("rejects unsupported or business-shaped values", (error) => {
    expect(isRetryableTransactionConflict(error)).toBe(false);
  });

  it("bounds wrapper traversal and tolerates cycles and throwing properties", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.cause = cyclic;
    Object.defineProperty(cyclic, "meta", {
      get() {
        throw new Error("inaccessible");
      },
    });
    expect(isRetryableTransactionConflict(cyclic)).toBe(false);

    let tooDeep: Record<string, unknown> = { code: "P2034" };
    for (let depth = 0; depth < 9; depth += 1) {
      tooDeep = { cause: tooDeep };
    }
    expect(isRetryableTransactionConflict(tooDeep)).toBe(false);
  });
});
