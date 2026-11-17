import { describe, expect, it } from "vitest";
import { createOutputBuffer } from "./output-buffer";

describe("output buffer", () => {
  it("hands out only what arrived since the last take", () => {
    const buffer = createOutputBuffer(100);
    buffer.append("one ");
    buffer.append("two ");
    expect(buffer.take()).toBe("one two ");
    buffer.append("three");
    expect(buffer.take()).toBe("three");
    expect(buffer.take()).toBe("");
    expect(buffer.truncated()).toBe(false);
  });

  it("stops at the limit without splitting a character", () => {
    const buffer = createOutputBuffer(5);
    buffer.append("abc");
    buffer.append("dé!");
    buffer.append("more");

    expect(buffer.take()).toBe("abcd");
    expect(buffer.truncated()).toBe(true);
  });

  it("accepts output that fills the limit exactly", () => {
    const buffer = createOutputBuffer(4);
    buffer.append("abcd");
    expect(buffer.take()).toBe("abcd");
    expect(buffer.truncated()).toBe(false);
  });
});
