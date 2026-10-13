import type { FlowDefinition } from "@repo/flows/definition";
import { describe, expect, it } from "vitest";
import {
  canvasToDefinition,
  createEdgeId,
  createNodeId,
  definitionToCanvas,
} from "./flow-definition-mapping";

const definition: FlowDefinition = {
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "main", target: "check" },
    { id: "e2", source: "check", sourceHandle: "true", target: "tag" },
    { id: "e3", source: "check", sourceHandle: "false", target: "tag" },
  ],
  nodes: [
    {
      config: { inputs: [{ key: "csvFile", label: "CSV file", type: "file" }] },
      id: "trigger",
      name: "Start",
      position: { x: 0, y: 40.5 },
      type: "trigger.manual",
    },
    {
      config: {
        combinator: "all",
        conditions: [
          {
            left: "{{ $json.Total }}",
            operator: "gt",
            right: "1000",
            valueType: "number",
          },
        ],
      },
      id: "check",
      name: "",
      position: { x: 280, y: -12 },
      type: "logic.if",
    },
    {
      config: { resourceId: "{{ $json.order.id }}", tags: ["high-value"] },
      id: "tag",
      name: "Tag it",
      position: { x: 560, y: 0 },
      type: "shopify.addTags",
    },
  ],
  schemaVersion: 1,
};

describe("flow definition mapping", () => {
  it("round-trips a definition through the canvas unchanged", () => {
    const { edges, nodes } = definitionToCanvas(definition);

    expect(canvasToDefinition(nodes, edges)).toEqual(definition);
  });

  it("round-trips an empty flow", () => {
    const empty: FlowDefinition = { edges: [], nodes: [], schemaVersion: 1 };
    const { edges, nodes } = definitionToCanvas(empty);

    expect(canvasToDefinition(nodes, edges)).toEqual(empty);
  });

  it("keeps the flow node type in data and renders every node with one component", () => {
    const { edges, nodes } = definitionToCanvas(definition);

    expect(nodes.map(({ type }) => type)).toEqual([
      "flowNode",
      "flowNode",
      "flowNode",
    ]);
    expect(nodes[1]?.data.nodeType).toBe("logic.if");
    expect(edges[1]).toMatchObject({ sourceHandle: "true", target: "tag" });
  });

  it("ignores canvas-only state such as selection when mapping back", () => {
    const { edges, nodes } = definitionToCanvas(definition);
    const touched = nodes.map((node) => ({
      ...node,
      dragging: true,
      measured: { height: 80, width: 200 },
      selected: true,
    }));

    expect(canvasToDefinition(touched, edges)).toEqual(definition);
  });

  it("creates readable ids that do not collide", () => {
    expect(createNodeId("shopify.addTags", new Set())).toBe("addTags-1");
    expect(
      createNodeId("shopify.addTags", new Set(["addTags-1", "addTags-2"]))
    ).toBe("addTags-3");
    expect(createEdgeId("check", "true", "tag")).toBe("check-true-tag");
  });
});
