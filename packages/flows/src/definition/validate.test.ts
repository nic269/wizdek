import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineNodeSpec } from "./node-spec";
import type { FlowDefinition, FlowEdge, FlowNode } from "./schema";
import { builtInNodeSpecs } from "./specs";
import { validateFlowDefinition } from "./validate";

const node = (
  id: string,
  type: string,
  config: Record<string, unknown> = {}
): FlowNode => ({ config, id, name: id, position: { x: 0, y: 0 }, type });

const edge = (
  source: string,
  target: string,
  sourceHandle = "main"
): FlowEdge => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

const flow = (nodes: FlowNode[], edges: FlowEdge[]): FlowDefinition => ({
  edges,
  nodes,
  schemaVersion: 1,
});

const csvFlow = () =>
  flow(
    [
      node("trigger", "trigger.manual", {
        inputs: [{ key: "csvFile", label: "CSV file", type: "file" }],
      }),
      node("parse", "data.parseCsv", { file: "{{ $json.csvFile }}" }),
      node("find", "shopify.findOrder", { value: '{{ $json["Order"] }}' }),
      node("check", "logic.if", {
        conditions: [
          {
            left: "{{ $json.Total }}",
            operator: "gt",
            right: "1000",
            valueType: "number",
          },
        ],
      }),
      node("tag", "shopify.addTags", {
        resourceId: "{{ $json.order.id }}",
        tags: ["high-value"],
      }),
    ],
    [
      edge("trigger", "parse"),
      edge("parse", "find"),
      edge("find", "check"),
      edge("check", "tag", "true"),
    ]
  );

const issuesOf = (definition: FlowDefinition) =>
  validateFlowDefinition(definition, builtInNodeSpecs).issues.map(
    ({ code, nodeId }) => `${code}:${nodeId ?? "-"}`
  );

describe("validateFlowDefinition", () => {
  it("accepts the CSV order-tagging flow", () => {
    expect(validateFlowDefinition(csvFlow(), builtInNodeSpecs)).toEqual({
      issues: [],
      valid: true,
    });
  });

  it("flags a cycle on the nodes that form it", () => {
    const definition = csvFlow();
    definition.edges.push(edge("tag", "find"));

    const issues = issuesOf(definition);
    expect(issues).toEqual(
      expect.arrayContaining(["CYCLE:find", "CYCLE:check", "CYCLE:tag"])
    );
    expect(issues).not.toContain("CYCLE:parse");
    expect(issues).not.toContain("CYCLE:trigger");
  });

  it("flags a node that the trigger never reaches", () => {
    const definition = csvFlow();
    definition.nodes.push(
      node("orphan", "shopify.addTags", { resourceId: "x", tags: ["t"] })
    );

    expect(issuesOf(definition)).toEqual(["UNREACHABLE:orphan"]);
  });

  it("flags a second trigger, and a flow without one", () => {
    const definition = csvFlow();
    definition.nodes.push(node("again", "trigger.manual"));
    expect(issuesOf(definition)).toEqual(["MULTIPLE_TRIGGERS:again"]);

    expect(
      issuesOf(
        flow(
          [node("tag", "shopify.addTags", { resourceId: "x", tags: ["t"] })],
          []
        )
      )
    ).toEqual(["NO_TRIGGER:-"]);
  });

  it("flags a missing required config field on its node, with the field path", () => {
    const definition = csvFlow();
    const tag = definition.nodes.find(({ id }) => id === "tag") as FlowNode;
    tag.config = { tags: [] };

    const { issues } = validateFlowDefinition(definition, builtInNodeSpecs);
    expect(
      issues.map(({ code, nodeId, path }) => [code, nodeId, path])
    ).toEqual([
      ["INVALID_CONFIG", "tag", "resourceId"],
      ["INVALID_CONFIG", "tag", "tags"],
    ]);
  });

  it("flags edges that leave from an output the node does not have", () => {
    const definition = csvFlow();
    definition.edges.push(edge("check", "tag", "maybe"));
    definition.edges.push(edge("parse", "ghost"));
    definition.edges.push(edge("tag", "trigger"));

    expect(issuesOf(definition)).toEqual([
      "UNKNOWN_OUTPUT:check",
      "EDGE_ENDPOINT_MISSING:parse",
      "EDGE_INTO_TRIGGER:trigger",
    ]);
  });

  it("flags unknown node types and duplicate ids", () => {
    const definition = csvFlow();
    definition.nodes.push(node("mystery", "code.eval"));
    definition.nodes.push(node("tag", "shopify.addTags"));
    definition.edges.push(edge("tag", "mystery"));

    expect(issuesOf(definition)).toEqual([
      "UNKNOWN_NODE_TYPE:mystery",
      "DUPLICATE_NODE:tag",
    ]);
  });

  it("resolves outputs that depend on the node's configuration", () => {
    const switchSpec = defineNodeSpec({
      category: "logic",
      configSchema: z.object({ cases: z.array(z.string()).min(1) }),
      description: "Routes by case.",
      idempotent: true,
      label: "Switch",
      mode: "item",
      outputs: (config) => [...config.cases, "default"],
      type: "test.switch",
    });
    const definition = flow(
      [
        node("trigger", "trigger.manual"),
        node("switch", "test.switch", { cases: ["gold", "silver"] }),
        node("tag", "shopify.addTags", { resourceId: "x", tags: ["t"] }),
      ],
      [
        edge("trigger", "switch"),
        edge("switch", "tag", "gold"),
        edge("switch", "tag", "bronze"),
      ]
    );

    expect(
      validateFlowDefinition(definition, [
        ...builtInNodeSpecs,
        switchSpec,
      ]).issues.map(({ code, edgeId }) => [code, edgeId])
    ).toEqual([["UNKNOWN_OUTPUT", "switch-bronze-tag"]]);
  });
});
