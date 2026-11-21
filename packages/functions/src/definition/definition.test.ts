import { describe, expect, it } from "vitest";
import {
  aliasOf,
  entryFileOf,
  FUNCTION_LIMITS,
  filesProblem,
  GRANT_ALIAS,
  isReadStatement,
  isSafeRelativePath,
  type ParamsSchema,
  validateParams,
} from ".";

describe("file paths", () => {
  it("accepts plain relative paths", () => {
    for (const path of ["index.ts", "lib/greet.ts", "a-b_c/d.e.py"]) {
      expect(isSafeRelativePath(path)).toBe(true);
    }
  });

  it("refuses paths that could leave the function's directory", () => {
    for (const path of [
      "",
      "/etc/passwd",
      "../secret",
      "lib/../../x",
      "./index.ts",
      "lib//x.ts",
      "lib\\x.ts",
      "with space.ts",
      "node_modules/pkg/index.js",
      "a".repeat(FUNCTION_LIMITS.pathLength + 1),
    ]) {
      expect(isSafeRelativePath(path)).toBe(false);
    }
  });

  it("explains the first problem with a set of files", () => {
    expect(filesProblem([])).toContain("at least one file");
    expect(filesProblem([{ content: "", path: "../x" }])).toContain(
      "not a valid file path"
    );
    expect(
      filesProblem([
        { content: "", path: "a.ts" },
        { content: "", path: "a.ts" },
      ])
    ).toContain("listed twice");
    expect(
      filesProblem([
        { content: "x".repeat(FUNCTION_LIMITS.fileBytes + 1), path: "a.ts" },
      ])
    ).toContain("larger than");
    expect(filesProblem([{ content: "", path: "index.ts" }])).toBeUndefined();
  });

  it("picks the entry file a runtime starts from", () => {
    expect(entryFileOf("NODE", ["lib.ts", "index.js", "index.ts"])).toBe(
      "index.ts"
    );
    expect(entryFileOf("PYTHON", ["helper.py"])).toBeUndefined();
  });
});

describe("validating parameters", () => {
  const schema: ParamsSchema = {
    properties: {
      dryRun: { default: false, type: "boolean" },
      limit: { default: 10, type: "integer" },
      mode: { enum: ["fast", "safe"], type: "string" },
      orderId: { type: "string" },
      payload: {},
      ratio: { type: "number" },
      tags: { items: { type: "string" }, type: "array" },
    },
    required: ["orderId"],
    type: "object",
    "x-order": [
      "orderId",
      "limit",
      "dryRun",
      "mode",
      "ratio",
      "tags",
      "payload",
    ],
  };

  it("accepts typed values and leaves out missing optional ones", () => {
    expect(
      validateParams(schema, {
        orderId: "#1001",
        payload: { any: ["json"] },
        tags: ["a", "b"],
      })
    ).toEqual({
      ok: true,
      params: {
        orderId: "#1001",
        payload: { any: ["json"] },
        tags: ["a", "b"],
      },
    });
  });

  it("names every parameter that is wrong", () => {
    expect(
      validateParams(schema, {
        dryRun: "yes",
        extra: 1,
        limit: 1.5,
        mode: "slow",
        ratio: Number.NaN,
        tags: [1],
      })
    ).toEqual({
      errors: {
        dryRun: "must be true or false",
        extra: "is not a parameter of main",
        limit: "must be a whole number",
        mode: "must be one of fast, safe",
        orderId: "is required",
        ratio: "must be a number",
        tags: "must be a list of text values",
      },
      ok: false,
    });
  });

  it("accepts any object without a schema", () => {
    expect(validateParams(null, { anything: 1 })).toEqual({
      ok: true,
      params: { anything: 1 },
    });
  });
});

describe("database statements", () => {
  it("counts select, show and explain as reads, after comments and space", () => {
    for (const sql of [
      "select 1",
      "  SELECT * from orders",
      "-- latest\nselect 1",
      "/* note */ explain select 1",
      "show server_version",
    ]) {
      expect(isReadStatement(sql)).toBe(true);
    }
  });

  it("counts everything else as a write, a with query included", () => {
    for (const sql of [
      "insert into t values (1)",
      "update t set a = 1",
      "with gone as (delete from t returning *) select * from gone",
      "/* select */ delete from t",
      "",
    ]) {
      expect(isReadStatement(sql)).toBe(false);
    }
  });
});

describe("grant aliases", () => {
  it("derives a valid alias from a resource name", () => {
    for (const name of ["Main Store", "Analytics (PROD)", "ÄÖ shop"]) {
      expect(aliasOf(name)).toMatch(GRANT_ALIAS);
    }
    expect(aliasOf("Main Store")).toBe("main-store");
  });
});
