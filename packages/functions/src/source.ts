import { createHash } from "node:crypto";
import type { FunctionFileInput } from "./definition";

/**
 * A hash of every file's path and content, independent of order. The editor
 * sends the hash it loaded so a save cannot overwrite someone else's.
 */
export const sourceHashOf = (files: readonly FunctionFileInput[]): string => {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    a.path < b.path ? -1 : Number(a.path > b.path)
  )) {
    hash.update(file.path).update("\0").update(file.content).update("\0");
  }
  return hash.digest("hex");
};
