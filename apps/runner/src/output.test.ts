import { describe, expect, it } from "vitest";
import { createOutputLimiter, createResultSplitter } from "./output";

const MARKER = "__FN_RESULT_0123456789abcdef__";
const RESULT = '{"ok":true,"value":{"a":1}}';

const split = (chunks: string[], maxResultBytes = 1024) => {
  const splitter = createResultSplitter(MARKER, maxResultBytes);
  const output = chunks.map((chunk) => splitter.push(chunk)).join("");
  const rest = splitter.finish();
  return { ...rest, output: output + rest.output };
};

describe("createResultSplitter", () => {
  it("separates the result line from the output before it", () => {
    expect(split([`hello\nworld\n${MARKER} ${RESULT}\n`])).toEqual({
      output: "hello\nworld",
      result: RESULT,
      resultTooLarge: false,
    });
  });

  it("finds a result line that arrives in pieces", () => {
    const text = `partial line\n${MARKER} ${RESULT}\n`;
    for (let size = 1; size <= 7; size += 1) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];
      expect(split(chunks)).toEqual({
        output: "partial line",
        result: RESULT,
        resultTooLarge: false,
      });
    }
  });

  it("passes everything through when there is no result line", () => {
    expect(split(["no newline at the end", "\n__FN_RESULT_ almost"])).toEqual({
      output: "no newline at the end\n__FN_RESULT_ almost",
      result: null,
      resultTooLarge: false,
    });
  });

  it("holds back only a tail that could begin the result line", () => {
    const splitter = createResultSplitter(MARKER, 1024);

    expect(splitter.push("abc\n__FN")).toBe("abc");
    expect(splitter.push(" not it\n")).toBe("\n__FN not it");
  });

  it("flags a result that is larger than allowed", () => {
    const huge = "x".repeat(4000);
    const outcome = split([`\n${MARKER} `, huge, huge, "\n"], 1024);

    expect(outcome.resultTooLarge).toBe(true);
  });
});

describe("createOutputLimiter", () => {
  it("lets output through up to the limit, then nothing", () => {
    const limiter = createOutputLimiter(10);

    expect(limiter.take("12345")).toBe("12345");
    expect(limiter.truncated()).toBe(false);
    expect(limiter.take("6789012345")).toBe("67890");
    expect(limiter.truncated()).toBe(true);
    expect(limiter.take("more")).toBe("");
  });

  it("does not end on half of a multi-byte character", () => {
    const limiter = createOutputLimiter(4);

    expect(limiter.take("aaaé")).toBe("aaa");
    expect(limiter.truncated()).toBe(true);
  });
});
