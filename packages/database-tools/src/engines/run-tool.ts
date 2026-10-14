import { spawn } from "node:child_process";
import { basename } from "node:path";
import { DatabaseToolsError } from "../errors";
import { redactSecrets } from "../redact";

const OUTPUT_TAIL_CHARACTERS = 4000;
const KILL_GRACE_MS = 5000;

export interface RunToolInput {
  args: readonly string[];
  command: string;
  /** The child's whole environment; nothing is inherited from this process. */
  env: Readonly<Record<string, string>>;
  /** Scrubbed from any output that ends up in an error message. */
  secrets?: readonly string[];
  signal?: AbortSignal;
}

export interface RunToolResult {
  stderrTail: string;
  stdoutBytes: number;
  stdoutTail: string;
}

const appendTail = (tail: string, chunk: Buffer) => {
  const next = tail + chunk.toString("utf8");
  return next.length > OUTPUT_TAIL_CHARACTERS
    ? next.slice(-OUTPUT_TAIL_CHARACTERS)
    : next;
};

/**
 * Runs a command without a shell and resolves once it exits successfully.
 * Only the end of its output is kept, so a chatty tool cannot exhaust memory.
 * Aborting the signal stops the child, forcefully after a grace period.
 */
export const runTool = (input: RunToolInput): Promise<RunToolResult> =>
  new Promise((resolve, reject) => {
    const name = basename(input.command);
    if (input.signal?.aborted) {
      reject(new DatabaseToolsError("ABORTED", `${name} was not started.`));
      return;
    }

    const child = spawn(input.command, input.args, {
      env: input.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutTail = "";
    let stdoutBytes = 0;
    let stderrTail = "";
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      stdoutTail = appendTail(stdoutTail, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk);
    });

    const finish = () => {
      input.signal?.removeEventListener("abort", onAbort);
      clearTimeout(killTimer);
    };

    child.once("error", (error: NodeJS.ErrnoException) => {
      finish();
      reject(
        error.code === "ENOENT"
          ? new DatabaseToolsError(
              "TOOL_NOT_FOUND",
              `${name} is not installed. Install the PostgreSQL client tools, or set POSTGRES_CLIENT_BIN_DIR to the directory that contains them.`
            )
          : new DatabaseToolsError(
              "TOOL_FAILED",
              `${name} could not be started: ${error.message}`
            )
      );
    });

    child.once("close", (code) => {
      finish();
      if (aborted) {
        reject(new DatabaseToolsError("ABORTED", `${name} was stopped.`));
        return;
      }
      if (code !== 0) {
        const detail = redactSecrets(stderrTail.trim(), input.secrets);
        reject(
          new DatabaseToolsError(
            "TOOL_FAILED",
            `${name} exited with code ${code}${detail ? `: ${detail}` : "."}`
          )
        );
        return;
      }
      resolve({ stderrTail, stdoutBytes, stdoutTail });
    });
  });
