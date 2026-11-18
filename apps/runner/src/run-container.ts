import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Admission } from "./admission";
import { DEPS_MOUNTS, type DepsCache } from "./deps-cache";
import {
  killContainer,
  runDocker,
  spawnDocker,
  wasOomKilled,
} from "./docker-cli";
import { createOutputLimiter, createResultSplitter } from "./output";
import {
  ENTRY_FILES,
  LIMITS,
  type RunEvent,
  type RunRequest,
  type RunStatus,
  type RuntimeId,
} from "./protocol";
import type { RuntimeImages } from "./runtime-images";
import { removeRunFiles, writeRunFiles } from "./workspace";

const MILLISECONDS = 1000;

const COMMANDS: Record<RuntimeId, readonly string[]> = {
  NODE: [
    "node",
    "--disable-warning=ExperimentalWarning",
    // A package.json written for its dependencies rarely sets "type".
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "/opt/fn/wrapper.mjs",
  ],
  // -P keeps the wrapper's own directory off the import path.
  PYTHON: ["python", "-P", "-u", "/opt/fn/wrapper.py"],
};

export interface RunnerConfig {
  dns: string;
  sandboxNetwork: string;
  workDir: string;
}

export type RefusalCode =
  | "BUSY"
  | "DEPS_MISSING"
  | "DUPLICATE_RUN"
  | "NO_ENTRY_FILE"
  | "RUNTIME_NOT_READY";

/** A run that was not started; nothing was written or reserved. */
export class RunRefusedError extends Error {
  readonly code: RefusalCode;

  constructor(code: RefusalCode, message: string) {
    super(message);
    this.code = code;
    this.name = "RunRefusedError";
  }
}

export type Emit = (event: RunEvent) => void;

export interface Runner {
  /** Stops a run. False when no such run is active. */
  cancel(runId: string): boolean;
  cancelAll(): void;
  /**
   * Checks and reserves what a run needs, or throws `RunRefusedError`. The
   * returned function executes the run, reports through `emit`, and always
   * finishes with an `exit` event.
   */
  prepare(request: RunRequest): (emit: Emit) => Promise<void>;
}

interface WrapperResult {
  error?: string;
  ok: boolean;
  value?: unknown;
}

const parseWrapperResult = (text: string | null): WrapperResult | null => {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as WrapperResult;
  } catch {
    return null;
  }
};

/** Mounts the hardening shared by runs and installs, then image and command. */
export const sandboxArguments = (input: {
  command: readonly string[];
  config: RunnerConfig;
  env?: readonly string[];
  image: string;
  memoryMb: number;
  name: string;
  pids: number;
  tmpfsMb: number;
  user: string;
  volumes: readonly string[];
  workdir?: string;
}): string[] => [
  "run",
  "--name",
  input.name,
  "--init",
  // Output is streamed to the caller; nothing is written to the host's disk.
  "--log-driver",
  "none",
  "--network",
  input.config.sandboxNetwork,
  "--dns",
  input.config.dns,
  "--read-only",
  "--tmpfs",
  `/tmp:rw,size=${input.tmpfsMb}m,mode=1777`,
  "--memory",
  `${input.memoryMb}m`,
  // Equal to the memory limit, so the container gets no swap.
  "--memory-swap",
  `${input.memoryMb}m`,
  "--cpus",
  "1",
  "--pids-limit",
  String(input.pids),
  "--ulimit",
  "nofile=1024:1024",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--user",
  input.user,
  ...input.volumes.flatMap((volume) => ["--volume", volume]),
  ...(input.env ?? []).flatMap((variable) => ["--env", variable]),
  ...(input.workdir ? ["--workdir", input.workdir] : []),
  input.image,
  ...input.command,
];

const containerArguments = (input: {
  command: readonly string[];
  config: RunnerConfig;
  deps: { path: string; runtime: RuntimeId } | null;
  image: string;
  memoryMb: number;
  name: string;
  source: string;
}): string[] => {
  const volumes = [`${input.source}:/fn:ro`];
  const env: string[] = [];
  if (input.deps) {
    const mount = DEPS_MOUNTS[input.deps.runtime];
    volumes.push(`${input.deps.path}/${mount.directory}:${mount.target}:ro`);
    if (mount.env) {
      env.push(mount.env);
    }
  }
  const args = sandboxArguments({
    command: input.command,
    config: input.config,
    env,
    image: input.image,
    memoryMb: input.memoryMb,
    name: input.name,
    pids: 128,
    tmpfsMb: 64,
    user: "10001:10001",
    volumes,
  });
  // The request reaches the wrapper on stdin.
  return [args[0] as string, "--interactive", ...args.slice(1)];
};

const outcomeOf = (input: {
  code: number | null;
  dockerError: string;
  memoryMb: number;
  oomKilled: boolean;
  resultTooLarge: boolean;
  state: "running" | "canceled" | "timedOut";
  timeoutSeconds: number;
  wrapper: WrapperResult | null;
}): { error?: string; result?: unknown; status: RunStatus } => {
  if (input.state === "canceled") {
    return { status: "CANCELED" };
  }
  if (input.state === "timedOut") {
    return {
      error: `The function timed out after ${input.timeoutSeconds} seconds.`,
      status: "TIMED_OUT",
    };
  }
  if (input.oomKilled) {
    return {
      error: `The function exceeded its ${input.memoryMb} MB memory limit.`,
      status: "FAILED",
    };
  }
  if (input.resultTooLarge) {
    return {
      error: `The result is larger than ${LIMITS.resultBytes} bytes.`,
      status: "FAILED",
    };
  }
  if (input.code === 0) {
    return { result: input.wrapper?.value ?? null, status: "SUCCEEDED" };
  }
  return {
    error:
      input.wrapper?.error ??
      (input.dockerError || `The function exited with code ${input.code}.`),
    status: "FAILED",
  };
};

export const createRunner = (dependencies: {
  admission: Admission;
  config: RunnerConfig;
  deps: DepsCache;
  images: RuntimeImages;
}): Runner => {
  const { admission, config, deps, images } = dependencies;
  const active = new Map<string, () => void>();

  const execute = async (
    request: RunRequest,
    image: string,
    entry: string,
    emit: Emit
  ): Promise<void> => {
    const depsPath = request.depsKey ? deps.pathOf(request.depsKey) : null;
    const name = `fn-${request.runId}`;
    const marker = `__FN_RESULT_${randomBytes(16).toString("hex")}__`;
    const startedAt = Date.now();
    const limiter = createOutputLimiter(LIMITS.outputBytes);
    const splitter = createResultSplitter(marker, LIMITS.resultBytes);
    let state: "running" | "canceled" | "timedOut" = "running";
    let closed = false;
    let workRoot: string | undefined;
    let dockerError = "";

    const kill = () => killContainer(name, () => closed);
    const stop = (reason: "canceled" | "timedOut") => {
      if (state === "running") {
        state = reason;
        kill();
      }
    };

    active.set(request.runId, () => stop("canceled"));
    const timer = setTimeout(
      () => stop("timedOut"),
      request.timeoutSeconds * MILLISECONDS
    );

    let code: number | null = null;
    try {
      const files = await writeRunFiles(
        config.workDir,
        request.runId,
        request.files
      );
      workRoot = files.root;
      if (depsPath && request.runtime === "NODE") {
        // The mount point, inside a directory that is mounted read-only.
        await mkdir(join(files.source, "node_modules"));
      }
      emit({ type: "started" });

      const child = spawnDocker(
        containerArguments({
          command: COMMANDS[request.runtime],
          config,
          deps: depsPath ? { path: depsPath, runtime: request.runtime } : null,
          image,
          memoryMb: request.memoryMb,
          name,
          source: files.source,
        })
      );
      const stdout = new StringDecoder("utf8");
      const stderr = new StringDecoder("utf8");
      const forward = (stream: "stdout" | "stderr", text: string) => {
        const data = limiter.take(text);
        if (data) {
          emit({ data, stream, type: "output" });
        }
      };
      child.stdout.on("data", (chunk: Buffer) => {
        forward("stdout", splitter.push(stdout.write(chunk)));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        forward("stderr", stderr.write(chunk));
      });
      // The wrapper may exit before reading everything.
      child.stdin.on("error", () => undefined);
      child.stdin.end(
        JSON.stringify({
          entry,
          env: request.env,
          marker,
          order: request.paramOrder ?? Object.keys(request.params),
          params: request.params,
        })
      );

      code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      forward("stdout", splitter.push(stdout.end()));
      forward("stderr", stderr.end());
    } catch (error) {
      dockerError = error instanceof Error ? error.message : String(error);
    } finally {
      closed = true;
      clearTimeout(timer);
    }

    const rest = splitter.finish();
    const remaining = limiter.take(rest.output);
    if (remaining) {
      emit({ data: remaining, stream: "stdout", type: "output" });
    }

    const oomKilled = await wasOomKilled(name);

    await runDocker(["rm", "--force", name]).catch(() => undefined);
    if (workRoot) {
      await removeRunFiles(workRoot).catch(() => undefined);
    }
    active.delete(request.runId);

    emit({
      durationMs: Date.now() - startedAt,
      exitCode: code,
      oomKilled,
      truncated: limiter.truncated(),
      type: "exit",
      ...outcomeOf({
        code,
        dockerError,
        memoryMb: request.memoryMb,
        oomKilled,
        resultTooLarge: rest.resultTooLarge,
        state,
        timeoutSeconds: request.timeoutSeconds,
        wrapper: parseWrapperResult(rest.result),
      }),
    });
  };

  return {
    cancel(runId) {
      const stop = active.get(runId);
      stop?.();
      return stop !== undefined;
    },
    cancelAll() {
      for (const stop of active.values()) {
        stop();
      }
    },
    prepare(request) {
      if (active.has(request.runId)) {
        throw new RunRefusedError(
          "DUPLICATE_RUN",
          "This run is already in progress."
        );
      }
      const runtime = images.get(request.runtime);
      if (!runtime?.ready) {
        throw new RunRefusedError(
          "RUNTIME_NOT_READY",
          `The ${request.runtime} runtime is not ready.`
        );
      }
      const paths = new Set(request.files.map((file) => file.path));
      const entry = ENTRY_FILES[request.runtime].find((file) =>
        paths.has(file)
      );
      if (!entry) {
        throw new RunRefusedError(
          "NO_ENTRY_FILE",
          `Add ${ENTRY_FILES[request.runtime].join(" or ")}.`
        );
      }
      const { depsKey } = request;
      if (
        depsKey &&
        !(
          depsKey.startsWith(`${request.runtime.toLowerCase()}-`) &&
          deps.readySize(depsKey) !== null
        )
      ) {
        throw new RunRefusedError(
          "DEPS_MISSING",
          "The function's packages are not installed on the runner."
        );
      }
      const release = admission.tryAcquire(request.memoryMb);
      if (!release) {
        throw new RunRefusedError("BUSY", "The runner is busy.");
      }
      // Kept from eviction until the run ends.
      const releaseDeps = depsKey ? deps.acquire(depsKey) : () => undefined;
      // Reserve the id now, so a second request cannot slip in before the
      // run starts. `execute` replaces this with the real stop function.
      active.set(request.runId, () => undefined);
      return async (emit) => {
        try {
          await execute(request, runtime.image, entry, emit);
        } finally {
          active.delete(request.runId);
          releaseDeps();
          release();
        }
      };
    },
  };
};
