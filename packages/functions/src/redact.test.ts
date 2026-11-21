import { describe, expect, it } from "vitest";
import { createStreamScrubber, scrubJson, scrubText } from "./redact";

const SECRET = "sk_live_123456";

describe("scrubbing variable values", () => {
  it("replaces values of six characters or more, and leaves short ones", () => {
    expect(scrubText(`key=${SECRET} pin=1234`, [SECRET, "1234"])).toBe(
      "key=[redacted] pin=1234"
    );
  });

  it("scrubs every string of a result, keys included", () => {
    expect(
      scrubJson(
        { list: [SECRET, 1, null], [SECRET]: { nested: `a${SECRET}` } },
        [SECRET]
      )
    ).toEqual({
      "[redacted]": { nested: "a[redacted]" },
      list: ["[redacted]", 1, null],
    });
  });

  it("catches a value split across output pieces", () => {
    const scrubber = createStreamScrubber([SECRET]);
    const pieces = ["start sk_li", "ve_12", "3456 end", " more"];
    const stored = pieces.map((piece) => scrubber.push(piece)).join("");
    expect(stored + scrubber.end()).toBe("start [redacted] end more");
  });

  it("passes output through untouched without secrets", () => {
    const scrubber = createStreamScrubber([]);
    expect(scrubber.push("hello")).toBe("hello");
    expect(scrubber.end()).toBe("");
  });
});
