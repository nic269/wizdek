import { describe, expect, it } from "vitest";
import { inspectTypeScript } from "./inspect-typescript";
import type { ParamsSchema } from "./protocol";

const schemaOf = (source: string): ParamsSchema => {
  const result = inspectTypeScript(source);
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result.schema;
};

const errorOf = (source: string): string | undefined => {
  const result = inspectTypeScript(source);
  return "error" in result ? result.error : undefined;
};

describe("inspectTypeScript", () => {
  it("reads typed parameters with defaults in declaration order", () => {
    expect(
      schemaOf(
        "export async function main(orderId: string, limit: number = 10, dryRun: boolean = false) {}"
      )
    ).toEqual({
      properties: {
        dryRun: { default: false, type: "boolean" },
        limit: { default: 10, type: "number" },
        orderId: { type: "string" },
      },
      required: ["orderId"],
      type: "object",
      "x-order": ["orderId", "limit", "dryRun"],
    });
  });

  it("maps arrays, string choices and optional parameters", () => {
    const schema = schemaOf(`
      export const main = (
        tags: string[],
        ids: Array<number>,
        mode: "fast" | "safe" = "safe",
        note?: string,
        cursor: string | null | undefined,
      ) => null;
    `);

    expect(schema.properties).toEqual({
      cursor: { type: "string" },
      ids: { items: { type: "number" }, type: "array" },
      mode: { default: "safe", enum: ["fast", "safe"], type: "string" },
      note: { type: "string" },
      tags: { items: { type: "string" }, type: "array" },
    });
    expect(schema.required).toEqual(["tags", "ids"]);
  });

  it("treats types it has no field for as any JSON value", () => {
    const schema = schemaOf(
      "export function main(filter: { status: string }, when: Date, mixed: string | number) {}"
    );

    expect(schema.properties).toEqual({ filter: {}, mixed: {}, when: {} });
  });

  it("infers the type of an untyped parameter from its default", () => {
    const schema = schemaOf(
      "export function main(name, count = 3, verbose = true, offset = -1, tags = ['a']) {}"
    );

    expect(schema.properties).toEqual({
      count: { default: 3, type: "number" },
      name: { type: "string" },
      offset: { default: -1, type: "number" },
      tags: { default: ["a"], items: { type: "string" }, type: "array" },
      verbose: { default: true, type: "boolean" },
    });
    expect(schema.required).toEqual(["name"]);
  });

  it("keeps a parameter optional when its default is not a literal", () => {
    const schema = schemaOf(
      "export function main(since: string = new Date().toISOString()) {}"
    );

    expect(schema.properties).toEqual({ since: { type: "string" } });
    expect(schema.required).toEqual([]);
  });

  it("takes descriptions from JSDoc", () => {
    const schema = schemaOf(`
      /**
       * @param orderId - The order to look up
       */
      export function main(orderId: string) {}
    `);

    expect(schema.properties.orderId).toEqual({
      description: "The order to look up",
      type: "string",
    });
  });

  it("finds main in CommonJS files", () => {
    expect(
      schemaOf("exports.main = async function (id: string) {};").required
    ).toEqual(["id"]);
    expect(
      schemaOf("module.exports.main = (id: string) => id;").required
    ).toEqual(["id"]);
  });

  it("accepts a main without parameters", () => {
    expect(schemaOf("export const main = () => 1;")).toEqual({
      properties: {},
      required: [],
      type: "object",
      "x-order": [],
    });
  });

  it("explains what it cannot read", () => {
    expect(errorOf("export function helper() {}")).toBe(
      "No function named main was found."
    );
    expect(errorOf("export function main({ id }: { id: string }) {}")).toBe(
      "main must take named parameters, not a destructured one."
    );
    expect(errorOf("export function main(...ids: string[]) {}")).toBe(
      "main cannot take a rest parameter."
    );
  });
});
