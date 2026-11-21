const REPLACEMENT_CHARACTER = "�";

/** How many characters at the end of `text` are a beginning of `needle`. */
const overlapWithStart = (text: string, needle: string): number => {
  const longest = Math.min(text.length, needle.length - 1);
  for (let length = longest; length > 0; length -= 1) {
    if (text.endsWith(needle.slice(0, length))) {
      return length;
    }
  }
  return 0;
};

export interface ResultSplitter {
  /** What is left once the stream ends. */
  finish(): { output: string; result: string | null; resultTooLarge: boolean };
  /** Takes a piece of stdout and returns the part that is ordinary output. */
  push(chunk: string): string;
}

/**
 * Separates the wrapper's result line from a function's stdout. The wrapper
 * ends stdout with a line `<marker> <json>`; everything before it is passed
 * through as it arrives, holding back only a tail that could be the start of
 * that line.
 */
export const createResultSplitter = (
  marker: string,
  maxResultBytes: number
): ResultSplitter => {
  const needle = `\n${marker} `;
  let pending = "";
  let result: string | null = null;
  let resultTooLarge = false;

  return {
    finish() {
      const line = result?.split("\n", 1)[0] ?? null;
      return { output: pending, result: line, resultTooLarge };
    },
    push(chunk) {
      if (result !== null) {
        if (Buffer.byteLength(result) > maxResultBytes) {
          resultTooLarge = true;
        } else {
          result += chunk;
        }
        return "";
      }
      pending += chunk;
      const at = pending.indexOf(needle);
      if (at >= 0) {
        const output = pending.slice(0, at);
        result = pending.slice(at + needle.length);
        pending = "";
        return output;
      }
      const held = overlapWithStart(pending, needle);
      const output = pending.slice(0, pending.length - held);
      pending = pending.slice(pending.length - held);
      return output;
    },
  };
};

export interface OutputLimiter {
  /** Returns as much of `data` as still fits. */
  take(data: string): string;
  truncated(): boolean;
}

/** Lets through a fixed number of bytes of output, then nothing. */
export const createOutputLimiter = (limitBytes: number): OutputLimiter => {
  let used = 0;
  let truncated = false;
  return {
    take(data) {
      if (truncated || data === "") {
        return "";
      }
      const bytes = Buffer.byteLength(data);
      if (used + bytes <= limitBytes) {
        used += bytes;
        return data;
      }
      truncated = true;
      const room = limitBytes - used;
      used = limitBytes;
      const cut = Buffer.from(data).subarray(0, room).toString("utf8");
      // A cut through a multi-byte character decodes to a replacement mark.
      return cut.endsWith(REPLACEMENT_CHARACTER) ? cut.slice(0, -1) : cut;
    },
    truncated: () => truncated,
  };
};
