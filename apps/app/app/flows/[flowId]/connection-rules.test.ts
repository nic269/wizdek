import { describe, expect, it } from "vitest";
import { refuseConnection } from "./connection-rules";

const edges = [
  { source: "trigger", sourceHandle: "main", target: "parse" },
  { source: "parse", sourceHandle: "main", target: "check" },
  { source: "check", sourceHandle: "true", target: "tag" },
];
const isTrigger = (nodeId: string) => nodeId === "trigger";

const refuse = (
  source: string | null,
  target: string | null,
  sourceHandle = "main"
) => refuseConnection({ source, sourceHandle, target }, edges, isTrigger);

describe("refuseConnection", () => {
  it("allows a connection that keeps the flow running one way", () => {
    expect(refuse("parse", "tag")).toBeNull();
    expect(refuse("check", "tag", "false")).toBeNull();
    expect(refuse("tag", "other")).toBeNull();
  });

  it("refuses a self-loop", () => {
    expect(refuse("check", "check")).toBe("SELF_LOOP");
  });

  it("refuses a connection into a trigger", () => {
    expect(refuse("tag", "trigger")).toBe("INTO_TRIGGER");
  });

  it("refuses a connection that would close a cycle, direct or indirect", () => {
    expect(refuse("check", "parse")).toBe("CYCLE");
    expect(refuse("tag", "parse")).toBe("CYCLE");
  });

  it("refuses a duplicate of an existing connection and an unfinished one", () => {
    expect(refuse("check", "tag", "true")).toBe("DUPLICATE");
    expect(refuse("check", null)).toBe("INCOMPLETE");
  });
});
