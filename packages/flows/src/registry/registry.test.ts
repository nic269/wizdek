import { describe, expect, it } from "vitest";
import { builtInNodes, builtInRegistry } from "../nodes";
import { createNodeRegistry } from "./registry";

describe("node registry", () => {
  it("serves the built-in nodes by type", () => {
    expect(builtInRegistry.list().map(({ type }) => type)).toEqual([
      "trigger.manual",
      "data.parseCsv",
      "logic.if",
      "shopify.findOrder",
      "shopify.addTags",
    ]);
    expect(builtInRegistry.get("logic.if")?.label).toBe("If");
    expect(builtInRegistry.get("code.eval")).toBeUndefined();
  });

  it("describes each node with its config as JSON Schema", () => {
    const metadata = builtInRegistry.metadata();
    const addTags = metadata.find(({ type }) => type === "shopify.addTags");

    expect(addTags).toMatchObject({
      category: "action",
      idempotent: true,
      mode: "item",
      outputs: ["main"],
    });
    expect(addTags?.configSchema).toMatchObject({
      properties: {
        resourceId: { type: "string" },
        tags: { items: { type: "string" }, type: "array" },
      },
      required: ["resourceId", "tags"],
      type: "object",
    });
    expect(metadata.find(({ type }) => type === "logic.if")?.outputs).toEqual([
      "true",
      "false",
    ]);
    // Fields with defaults are optional for whoever fills the form in.
    const parseCsv = metadata.find(({ type }) => type === "data.parseCsv");
    expect((parseCsv?.configSchema as { required: string[] }).required).toEqual(
      ["file"]
    );
    expect(() => JSON.stringify(metadata)).not.toThrow();
  });

  it("refuses to register a node type twice", () => {
    expect(() =>
      createNodeRegistry([...builtInNodes, ...builtInNodes])
    ).toThrow("registered twice");
  });
});
