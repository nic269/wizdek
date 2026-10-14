import { describe, expect, it } from "vitest";
import { DatabaseToolsError } from "../errors";
import { runTool } from "./run-tool";

const baseEnv = { PATH: process.env.PATH ?? "" };

const rejectionOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DatabaseToolsError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the command to fail.");
};

describe("runTool", () => {
  it("resolves with the output of a successful command", async () => {
    const result = await runTool({
      args: ["-e", "process.stdout.write('hello')"],
      command: process.execPath,
      env: baseEnv,
    });
    expect(result).toMatchObject({ stdoutBytes: 5, stdoutTail: "hello" });
  });

  it("passes only the given environment to the child", async () => {
    const result = await runTool({
      args: [
        "-e",
        "process.stdout.write(Object.keys(process.env).sort().join(','))",
      ],
      command: process.execPath,
      env: { ...baseEnv, ONLY_THIS: "1" },
    });
    expect(result.stdoutTail.split(",")).toEqual(
      expect.arrayContaining(["ONLY_THIS", "PATH"])
    );
    expect(result.stdoutTail).not.toContain("DATABASE_URL");
  });

  it("reports a non-zero exit with the redacted end of stderr", async () => {
    const error = await rejectionOf(
      runTool({
        args: [
          "-e",
          "console.error('auth failed for hunter2'); process.exit(3)",
        ],
        command: process.execPath,
        env: baseEnv,
        secrets: ["hunter2"],
      })
    );
    expect(error.failure).toBe("TOOL_FAILED");
    expect(error.message).toContain("exited with code 3");
    expect(error.message).toContain("auth failed for [redacted]");
  });

  it("explains a missing tool", async () => {
    const error = await rejectionOf(
      runTool({ args: [], command: "/nonexistent/pg_dump", env: baseEnv })
    );
    expect(error.failure).toBe("TOOL_NOT_FOUND");
    expect(error.message).toContain("POSTGRES_CLIENT_BIN_DIR");
  });

  it("stops the child when the signal aborts", async () => {
    const controller = new AbortController();
    const running = runTool({
      args: ["-e", "setTimeout(() => {}, 60000)"],
      command: process.execPath,
      env: baseEnv,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    const error = await rejectionOf(running);
    expect(error.failure).toBe("ABORTED");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("does not start when already aborted", async () => {
    const error = await rejectionOf(
      runTool({
        args: [],
        command: process.execPath,
        env: baseEnv,
        signal: AbortSignal.abort(),
      })
    );
    expect(error.failure).toBe("ABORTED");
  });
});
