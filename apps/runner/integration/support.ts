import { randomBytes } from "node:crypto";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdmission } from "../src/admission";
import { createRunnerApp } from "../src/app";
import { createDepsBuilder } from "../src/build-deps";
import { createDepsCache } from "../src/deps-cache";
import { runDocker } from "../src/docker-cli";
import type { DepsEvent, RunEvent } from "../src/protocol";
import { createRunner } from "../src/run-container";
import { createRuntimeImages } from "../src/runtime-images";

export const TOKEN = "integration-test-token-0123456789abcdef";

export const AUTHORIZED = {
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};

type ExitEvent = Extract<RunEvent, { type: "exit" }>;

/** Builds the runtime images once and returns an agent wired to local Docker. */
export const createTestAgent = async ({
  budgetMb = 2560,
  depsMaxBytes = 500 * 1024 * 1024,
}: {
  budgetMb?: number;
  depsMaxBytes?: number;
} = {}) => {
  const images = createRuntimeImages(join(process.cwd(), "runtimes"));
  await images.ensureAll();
  for (const runtime of images.list()) {
    if (!runtime.ready) {
      throw new Error(`Runtime ${runtime.id} is not ready: ${runtime.error}`);
    }
  }
  // Docker resolves bind mounts itself, so give it the real path.
  const workDir = await realpath(
    await mkdtemp(join(tmpdir(), "fn-runner-test-"))
  );
  const admission = createAdmission(budgetMb);
  const config = { dns: "1.1.1.1", sandboxNetwork: "bridge", workDir };
  const cache = createDepsCache({
    minFreeBytes: 0,
    root: join(workDir, "deps"),
    targetFreeBytes: 0,
  });
  const runner = createRunner({ admission, config, deps: cache, images });
  const deps = createDepsBuilder({
    admission,
    cache,
    config: { ...config, maxBytes: depsMaxBytes, minFreeBytes: 0 },
    images,
  });
  const app = createRunnerApp({ deps, images, runner, token: TOKEN });

  const start = (body: Record<string, unknown>) => {
    const runId = `test_${randomBytes(6).toString("hex")}`;
    const response = app.request("/runs", {
      body: JSON.stringify({
        memoryMb: 256,
        runId,
        timeoutSeconds: 60,
        ...body,
      }),
      headers: AUTHORIZED,
      method: "POST",
    });
    return { response, runId };
  };

  const run = async (body: Record<string, unknown>) => {
    const { response, runId } = start(body);
    return { runId, ...(await readRun(await response)) };
  };

  /** Installs packages and returns the stream's events. */
  const install = async (body: Record<string, unknown>) => {
    const response = await app.request("/deps", {
      body: JSON.stringify(body),
      headers: AUTHORIZED,
      method: "POST",
    });
    const text = await response.text();
    if (response.status !== 200) {
      throw new Error(`Install refused with ${response.status}: ${text}`);
    }
    const events = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DepsEvent);
    const done = events.at(-1);
    if (done?.type !== "done") {
      throw new Error("The stream did not end with a done event.");
    }
    const output = events
      .flatMap((event) => (event.type === "output" ? event.data : []))
      .join("");
    return { done, events, output };
  };

  return { app, cache, install, run, start, workDir };
};

export const readRun = async (response: Response) => {
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`Run refused with ${response.status}: ${text}`);
  }
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
  const exit = events.at(-1);
  if (exit?.type !== "exit") {
    throw new Error("The stream did not end with an exit event.");
  }
  const outputOf = (stream: "stdout" | "stderr") =>
    events
      .flatMap((event) =>
        event.type === "output" && event.stream === stream ? event.data : []
      )
      .join("");
  return {
    events,
    exit: exit as ExitEvent,
    stderr: outputOf("stderr"),
    stdout: outputOf("stdout"),
  };
};

/** Names of sandbox containers that still exist. */
export const leftoverContainers = async (): Promise<string[]> => {
  const listed = await runDocker([
    "ps",
    "--all",
    "--filter",
    "name=^fn-test_",
    "--format",
    "{{.Names}}",
  ]);
  return listed.stdout.split("\n").filter(Boolean);
};
