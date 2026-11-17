import { describe, expect, it } from "vitest";
import { isSafeRelativePath, LIMITS, runRequestSchema } from "./protocol";

const request = (overrides: Record<string, unknown> = {}) => ({
  files: [{ content: "export const main = () => 1;", path: "index.ts" }],
  memoryMb: 256,
  runId: "run_123456",
  runtime: "NODE",
  timeoutSeconds: 30,
  ...overrides,
});

describe("isSafeRelativePath", () => {
  it("accepts plain relative paths", () => {
    expect(isSafeRelativePath("index.ts")).toBe(true);
    expect(isSafeRelativePath("lib/http-client.ts")).toBe(true);
    expect(isSafeRelativePath("package.json")).toBe(true);
  });

  it("refuses anything that could leave the function's directory", () => {
    for (const path of [
      "",
      "/etc/passwd",
      "../secret",
      "lib/../../secret",
      "./index.ts",
      "lib//index.ts",
      "lib/",
      "a b.ts",
      "node_modules/pkg/index.js",
      "a".repeat(201),
    ]) {
      expect(isSafeRelativePath(path), path).toBe(false);
    }
  });
});

describe("runRequestSchema", () => {
  it("fills in empty params and variables", () => {
    const parsed = runRequestSchema.parse(request());

    expect(parsed.params).toEqual({});
    expect(parsed.env).toEqual({});
  });

  it("refuses unsupported memory sizes, timeouts and run ids", () => {
    expect(runRequestSchema.safeParse(request({ memoryMb: 300 })).success).toBe(
      false
    );
    expect(
      runRequestSchema.safeParse(
        request({ timeoutSeconds: LIMITS.timeoutSeconds + 1 })
      ).success
    ).toBe(false);
    expect(
      runRequestSchema.safeParse(request({ runId: "bad id; rm -rf" })).success
    ).toBe(false);
  });

  it("refuses an oversized file, a repeated path and too much source", () => {
    const big = "x".repeat(LIMITS.fileBytes + 1);
    expect(
      runRequestSchema.safeParse(
        request({ files: [{ content: big, path: "index.ts" }] })
      ).success
    ).toBe(false);

    expect(
      runRequestSchema.safeParse(
        request({
          files: [
            { content: "a", path: "index.ts" },
            { content: "b", path: "index.ts" },
          ],
        })
      ).success
    ).toBe(false);

    const chunk = "x".repeat(LIMITS.fileBytes);
    const files = Array.from({ length: 5 }, (_, index) => ({
      content: chunk,
      path: `file-${index}.ts`,
    }));
    expect(runRequestSchema.safeParse(request({ files })).success).toBe(false);
  });
});
