import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Admission } from "./admission";
import {
  DEPS_MOUNTS,
  type DepsCache,
  depsKeyOf,
  directorySize,
  SANDBOX_UID,
} from "./deps-cache";
import {
  killContainer,
  runDocker,
  spawnDocker,
  wasOomKilled,
} from "./docker-cli";
import { createOutputLimiter } from "./output";
import {
  DEPS_LIMITS,
  type DepsEvent,
  type DepsRequest,
  LIMITS,
  type RuntimeId,
} from "./protocol";
import {
  type RunnerConfig,
  RunRefusedError,
  sandboxArguments,
} from "./run-container";
import type { RuntimeImages } from "./runtime-images";

const MILLISECONDS = 1000;
const REUSED =
  "These packages were installed earlier for the same manifests; using them.\n";
const JOINED =
  "The same manifests are already installing; waiting for that install.\n";
const MEGABYTE = 1024 * 1024;

type DoneEvent = Extract<DepsEvent, { type: "done" }>;

export interface DepsBuilderConfig extends RunnerConfig {
  /** An install larger than this is discarded. */
  maxBytes: number;
  /** Installs are refused below this much free disk. */
  minFreeBytes: number;
}

export interface DepsBuilder {
  /**
   * Checks what an install needs, or throws `RunRefusedError`. The returned
   * function installs (or reuses) the packages, reports through `emit` and
   * always finishes with a `done` event.
   */
  prepare(
    request: DepsRequest
  ): (emit: (event: DepsEvent) => void) => Promise<void>;
}

/**
 * The install command. npm runs in the manifests' directory and fills its
 * `node_modules`; pip installs into `site`. Both leave out dev tooling.
 */
const installCommand = (
  runtime: RuntimeId,
  hasLock: boolean
): readonly string[] =>
  runtime === "NODE"
    ? [
        "npm",
        hasLock ? "ci" : "install",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
      ]
    : [
        "pip",
        "install",
        "--no-cache-dir",
        "--no-input",
        "--no-warn-script-location",
        "--target",
        `/deps/${DEPS_MOUNTS.PYTHON.directory}`,
        "--requirement",
        "/deps/requirements.txt",
      ];

/**
 * The user installs run as. Files they write must be removable by the agent
 * when the entry is evicted, so it is the agent's own user; an agent running
 * as root hands the directory to the sandbox user instead.
 */
const installUser = (): { owner: number | null; user: string } => {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || uid === 0 || gid === undefined) {
    return {
      owner: uid === 0 ? SANDBOX_UID : null,
      user: `${SANDBOX_UID}:${SANDBOX_UID}`,
    };
  }
  return { owner: null, user: `${uid}:${gid}` };
};

interface ContainerOutcome {
  code: number | null;
  dockerError: string;
  oomKilled: boolean;
  timedOut: boolean;
}

/**
 * Runs one install container to the end, forwarding its output, and kills
 * it at the install timeout. The container is removed before returning.
 */
const runInstallContainer = async (input: {
  args: (name: string) => string[];
  emit: (event: DepsEvent) => void;
  prepare: () => Promise<void>;
}): Promise<ContainerOutcome> => {
  const name = `fn-deps-${randomBytes(8).toString("hex")}`;
  const limiter = createOutputLimiter(LIMITS.outputBytes);
  const outcome: ContainerOutcome = {
    code: null,
    dockerError: "",
    oomKilled: false,
    timedOut: false,
  };
  let closed = false;
  const timer = setTimeout(() => {
    outcome.timedOut = true;
    killContainer(name, () => closed);
  }, DEPS_LIMITS.timeoutSeconds * MILLISECONDS);

  try {
    await input.prepare();
    const child = spawnDocker(input.args(name));
    const decoders = {
      stderr: new StringDecoder("utf8"),
      stdout: new StringDecoder("utf8"),
    };
    const forward = (stream: "stdout" | "stderr", text: string) => {
      const data = limiter.take(text);
      if (data) {
        input.emit({ data, stream, type: "output" });
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      forward("stdout", decoders.stdout.write(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      forward("stderr", decoders.stderr.write(chunk));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end();
    outcome.code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    forward("stdout", decoders.stdout.end());
    forward("stderr", decoders.stderr.end());
  } catch (error) {
    outcome.dockerError =
      error instanceof Error ? error.message : String(error);
  } finally {
    closed = true;
    clearTimeout(timer);
  }

  outcome.oomKilled = await wasOomKilled(name);
  await runDocker(["rm", "--force", name]).catch(() => undefined);
  return outcome;
};

export const createDepsBuilder = (dependencies: {
  admission: Admission;
  cache: DepsCache;
  config: DepsBuilderConfig;
  images: RuntimeImages;
}): DepsBuilder => {
  const { admission, cache, config, images } = dependencies;
  /** Installs in progress by key; a second request waits for the first. */
  const building = new Map<string, Promise<DoneEvent>>();

  const install = async (
    request: DepsRequest,
    image: string,
    key: string,
    emit: (event: DepsEvent) => void
  ): Promise<DoneEvent> => {
    const failed = (error: string): DoneEvent => ({
      error,
      key,
      sizeBytes: null,
      status: "FAILED",
      type: "done",
    });

    if ((await cache.freeBytes()) < config.minFreeBytes) {
      await cache.evict();
      if ((await cache.freeBytes()) < config.minFreeBytes) {
        return failed("The runner is low on disk space. Try again later.");
      }
    }

    const { owner, user } = installUser();
    const temp = await cache.createTemp(key, owner);
    const outcome = await runInstallContainer({
      args: (name) =>
        sandboxArguments({
          command: installCommand(
            request.runtime,
            request.manifests.some(({ path }) => path === "package-lock.json")
          ),
          config,
          image,
          memoryMb: DEPS_LIMITS.memoryMb,
          name,
          pids: 256,
          // npm keeps its download cache here.
          tmpfsMb: 512,
          user,
          volumes: [`${temp}:/deps`],
          workdir: "/deps",
        }),
      emit,
      prepare: async () => {
        for (const manifest of request.manifests) {
          await writeFile(join(temp, manifest.path), manifest.content);
        }
      },
    });

    const discard = () =>
      rm(temp, { force: true, recursive: true }).catch(() => undefined);
    if (outcome.timedOut) {
      await discard();
      return failed(
        `The install timed out after ${DEPS_LIMITS.timeoutSeconds} seconds.`
      );
    }
    if (outcome.oomKilled) {
      await discard();
      return failed(
        `The install exceeded its ${DEPS_LIMITS.memoryMb} MB memory limit.`
      );
    }
    if (outcome.code !== 0) {
      await discard();
      return failed(
        outcome.dockerError ||
          `The install failed with exit code ${outcome.code}.`
      );
    }

    // A manifest without dependencies installs nothing, but runs still
    // mount the directory.
    await mkdir(join(temp, DEPS_MOUNTS[request.runtime].directory), {
      recursive: true,
    });
    const sizeBytes = await directorySize(temp);
    if (sizeBytes > config.maxBytes) {
      await discard();
      return failed(
        `The packages take ${Math.ceil(sizeBytes / MEGABYTE)} MB, more than the ${Math.floor(config.maxBytes / MEGABYTE)} MB limit.`
      );
    }
    await cache.commit(temp, key, sizeBytes);
    return { key, sizeBytes, status: "READY", type: "done" };
  };

  return {
    prepare(request) {
      const runtime = images.get(request.runtime);
      if (!runtime?.ready) {
        throw new RunRefusedError(
          "RUNTIME_NOT_READY",
          `The ${request.runtime} runtime is not ready.`
        );
      }
      const key = depsKeyOf(request.runtime, runtime.image, request.manifests);
      const sizeBytes = cache.readySize(key);
      if (sizeBytes !== null) {
        return (emit) => {
          emit({ data: REUSED, stream: "stdout", type: "output" });
          emit({ key, sizeBytes, status: "READY", type: "done" });
          return Promise.resolve();
        };
      }
      const pending = building.get(key);
      if (pending) {
        return async (emit) => {
          emit({ data: JOINED, stream: "stdout", type: "output" });
          emit(await pending);
        };
      }
      const release = admission.tryAcquire(DEPS_LIMITS.memoryMb);
      if (!release) {
        throw new RunRefusedError("BUSY", "The runner is busy.");
      }
      let finish: (event: DoneEvent) => void = () => undefined;
      building.set(
        key,
        new Promise<DoneEvent>((resolve) => {
          finish = resolve;
        })
      );
      return async (emit) => {
        let done: DoneEvent = {
          error: "The install stopped unexpectedly.",
          key,
          sizeBytes: null,
          status: "FAILED",
          type: "done",
        };
        try {
          done = await install(request, runtime.image, key, emit);
        } catch (error) {
          done = {
            ...done,
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          building.delete(key);
          release();
          finish(done);
          emit(done);
          cache.evict().catch(() => undefined);
        }
      };
    },
  };
};
