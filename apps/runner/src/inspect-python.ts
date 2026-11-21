import { runDocker } from "./docker-cli";
import type { InspectResult } from "./protocol";

const INSPECT_TIMEOUT_MS = 20_000;

/**
 * Reads the parameters of `main` from a Python file. The inspector parses
 * the source with `ast` and never imports it; it still runs in a container
 * with no network, because the source is untrusted input to a parser.
 */
export const inspectPython = async (
  image: string,
  source: string
): Promise<InspectResult> => {
  const result = await runDocker(
    [
      "run",
      "--rm",
      "--interactive",
      "--network",
      "none",
      "--read-only",
      "--memory",
      "128m",
      "--pids-limit",
      "32",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "10001:10001",
      image,
      "python",
      "-P",
      "/opt/fn/read_params.py",
    ],
    { input: source, timeoutMs: INSPECT_TIMEOUT_MS }
  );
  if (result.code !== 0) {
    return { error: "The file could not be inspected." };
  }
  try {
    return JSON.parse(result.stdout) as InspectResult;
  } catch {
    return { error: "The file could not be inspected." };
  }
};
