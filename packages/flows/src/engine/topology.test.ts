import { describe, expect, it } from "vitest";
import type { FlowDefinition } from "../definition/schema";
import { builtInNodeSpecs } from "../definition/specs";
import { buildTopology } from "./topology";

const specs = (type: string) =>
  builtInNodeSpecs.find((spec) => spec.type === type);

const node = (id: string, type = "shopify.addTags") => ({
  config: {},
  id,
  name: id,
  position: { x: 0, y: 0 },
  type,
});

const edge = (source: string, target: string, sourceHandle = "main") => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

const flow = (
  nodes: ReturnType<typeof node>[],
  edges: ReturnType<typeof edge>[]
): FlowDefinition => ({ edges, nodes, schemaVersion: 1 });

describe("buildTopology", () => {
  it("orders every node after all of its sources, whatever the stored order", () => {
    const { order } = buildTopology(
      flow(
        [node("join"), node("b"), node("a"), node("t", "trigger.manual")],
        [
          edge("a", "join"),
          edge("b", "join"),
          edge("t", "a"),
          edge("t", "b"),
          edge("a", "b"),
        ]
      ),
      specs
    );
    const position = (id: string) =>
      order.findIndex((entry) => entry.id === id);

    expect(order).toHaveLength(4);
    expect(position("t")).toBe(0);
    expect(position("a")).toBeLessThan(position("b"));
    expect(position("b")).toBeLessThan(position("join"));
  });

  it("maps output handles to targets and counts incoming edges", () => {
    const { downstream, incoming } = buildTopology(
      flow(
        [
          node("t", "trigger.manual"),
          node("if", "logic.if"),
          node("x"),
          node("y"),
        ],
        [
          edge("t", "if"),
          edge("if", "x", "true"),
          edge("if", "y", "false"),
          edge("if", "x", "false"),
        ]
      ),
      specs
    );

    expect(downstream.get("if")?.get("true")).toEqual(["x"]);
    expect(downstream.get("if")?.get("false")).toEqual(["y", "x"]);
    expect(incoming.get("x")).toBe(2);
    expect(incoming.get("y")).toBe(1);
  });

  it("leaves out nodes the trigger cannot reach and rejects loops", () => {
    const { order } = buildTopology(
      flow(
        [node("t", "trigger.manual"), node("a"), node("island")],
        [edge("t", "a")]
      ),
      specs
    );
    expect(order.map(({ id }) => id)).toEqual(["t", "a"]);

    expect(() =>
      buildTopology(
        flow(
          [node("t", "trigger.manual"), node("a"), node("b")],
          [edge("t", "a"), edge("a", "b"), edge("b", "a")]
        ),
        specs
      )
    ).toThrow("loop");
    expect(() => buildTopology(flow([node("a")], []), specs)).toThrow(
      "no trigger"
    );
  });
});
