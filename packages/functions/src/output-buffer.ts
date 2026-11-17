/**
 * Collects a run's output for periodic writes to the database. It keeps at
 * most `limitBytes` in total, cut on a character boundary, and remembers
 * whether anything was dropped.
 */
export const createOutputBuffer = (limitBytes: number) => {
  let used = 0;
  let pending = "";
  let truncated = false;

  return {
    append(text: string): void {
      if (truncated || text.length === 0) {
        return;
      }
      const bytes = Buffer.byteLength(text, "utf8");
      if (used + bytes <= limitBytes) {
        used += bytes;
        pending += text;
        return;
      }
      truncated = true;
      let kept = "";
      let keptBytes = 0;
      for (const character of text) {
        const size = Buffer.byteLength(character, "utf8");
        if (used + keptBytes + size > limitBytes) {
          break;
        }
        kept += character;
        keptBytes += size;
      }
      used += keptBytes;
      pending += kept;
    },
    /** Output added since the last call. */
    take(): string {
      const text = pending;
      pending = "";
      return text;
    },
    truncated: () => truncated,
  };
};
