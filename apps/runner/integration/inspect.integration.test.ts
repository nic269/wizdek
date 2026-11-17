import { beforeAll, describe, expect, it } from "vitest";
import { AUTHORIZED, createTestAgent } from "./support";

const SETUP_TIMEOUT_MS = 600_000;
const INSPECT_TIMEOUT_MS = 60_000;

let agent: Awaited<ReturnType<typeof createTestAgent>>;

beforeAll(async () => {
  agent = await createTestAgent();
}, SETUP_TIMEOUT_MS);

const inspect = async (runtime: "NODE" | "PYTHON", source: string) => {
  const response = await agent.app.request("/inspect", {
    body: JSON.stringify({ runtime, source }),
    headers: AUTHORIZED,
    method: "POST",
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
};

describe("inspecting a Python file", () => {
  it(
    "reads typed parameters with defaults in declaration order",
    async () => {
      const result = await inspect(
        "PYTHON",
        [
          "from typing import Literal, Optional",
          "",
          "def main(",
          "    order_id: str,",
          "    limit: int = 10,",
          "    ratio: float = 0.5,",
          "    dry_run: bool = False,",
          "    tags: list[str] | None = None,",
          "    mode: Literal['fast', 'safe'] = 'safe',",
          "    note: Optional[str] = None,",
          "    payload: dict = {},",
          "    untyped=3,",
          "    *,",
          "    region: str,",
          "):",
          "    return None",
        ].join("\n")
      );

      expect(result).toEqual({
        schema: {
          properties: {
            dry_run: { default: false, type: "boolean" },
            limit: { default: 10, type: "integer" },
            mode: { default: "safe", enum: ["fast", "safe"], type: "string" },
            note: { type: "string" },
            order_id: { type: "string" },
            payload: { default: {} },
            ratio: { default: 0.5, type: "number" },
            region: { type: "string" },
            tags: { items: { type: "string" }, type: "array" },
            untyped: { default: 3, type: "integer" },
          },
          required: ["order_id", "region"],
          type: "object",
          "x-order": [
            "order_id",
            "limit",
            "ratio",
            "dry_run",
            "tags",
            "mode",
            "note",
            "payload",
            "untyped",
            "region",
          ],
        },
      });
    },
    INSPECT_TIMEOUT_MS
  );

  it(
    "explains what it cannot read without running the file",
    async () => {
      expect(await inspect("PYTHON", "def helper():\n    pass\n")).toEqual({
        error: "No function named main was found.",
      });
      expect(await inspect("PYTHON", "def main(*ids):\n    pass\n")).toEqual({
        error: "main cannot take *args or **kwargs.",
      });
      expect(await inspect("PYTHON", "def main(:\n")).toMatchObject({
        error: expect.stringContaining("Syntax error on line 1"),
      });
      // Code at module level would run on import; inspection must not run it.
      expect(
        await inspect(
          "PYTHON",
          "raise SystemExit('executed')\ndef main(a: str):\n    pass\n"
        )
      ).toMatchObject({ schema: { required: ["a"] } });
    },
    INSPECT_TIMEOUT_MS
  );
});

describe("inspecting a TypeScript file", () => {
  it("answers from the agent process", async () => {
    expect(
      await inspect(
        "NODE",
        "export function main(orderId: string, limit: number = 10) {}"
      )
    ).toMatchObject({
      schema: { required: ["orderId"], "x-order": ["orderId", "limit"] },
    });
  });
});
