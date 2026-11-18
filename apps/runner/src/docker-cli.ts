import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const CAPTURE_LIMIT_CHARACTERS = 64 * 1024;
const PASSED_THROUGH = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
];

/**
 * The docker CLI's whole environment: enough to find the daemon. Nothing
 * from a request, and none of the agent's own settings, is inherited.
 */
const dockerEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of PASSED_THROUGH) {
    const value = process.env[name];
    if (value) {
      environment[name] = value;
    }
  }
  return environment;
};

/** Starts the docker CLI without a shell, with its streams piped. */
export const spawnDocker = (
  args: readonly string[]
): ChildProcessWithoutNullStreams =>
  spawn("docker", args, {
    env: dockerEnvironment(),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

export interface DockerResult {
  code: number;
  stderr: string;
  stdout: string;
}

/**
 * Runs a docker command to completion and returns its exit code and the
 * start of its output. A non-zero exit is a result, not an exception.
 */
export const runDocker = (
  args: readonly string[],
  options: { input?: string; timeoutMs?: number } = {}
): Promise<DockerResult> =>
  new Promise((resolve, reject) => {
    const child = spawnDocker(args);
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < CAPTURE_LIMIT_CHARACTERS) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < CAPTURE_LIMIT_CHARACTERS) {
        stderr += chunk.toString("utf8");
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr, stdout });
    });
    // The command may exit without reading its input.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });

const KILL_RETRY_MS = 1000;
const KILL_ATTEMPTS = 30;

/**
 * Kills a container started with `docker run --name`. The container may not
 * exist yet when the kill arrives, so it keeps trying until `isDone` says
 * the docker CLI has exited.
 */
export const killContainer = (name: string, isDone: () => boolean): void => {
  let attempts = 0;
  const attempt = () => {
    if (isDone() || attempts >= KILL_ATTEMPTS) {
      return;
    }
    attempts += 1;
    runDocker(["kill", name])
      .catch(() => undefined)
      .finally(() => setTimeout(attempt, KILL_RETRY_MS).unref());
  };
  attempt();
};

/** Whether the kernel killed a container for exceeding its memory limit. */
export const wasOomKilled = async (name: string): Promise<boolean> => {
  const inspection = await runDocker([
    "inspect",
    "--format",
    "{{.State.OOMKilled}}",
    name,
  ]).catch(() => null);
  return inspection?.stdout.trim() === "true";
};
