import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "e2e-with-db.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});
const waitForOutput = async (
  stream: NodeJS.ReadableStream,
  expected: string
) => {
  let output = "";
  for await (const chunk of stream) {
    output += String(chunk);
    if (output.includes(expected)) {
      return;
    }
  }
  throw new Error(`Process exited before emitting ${expected}.`);
};

describe("E2E database runner", () => {
  it("cleans task-owned resources when interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "e2e-interruption-"));
    roots.push(root);
    const bin = join(root, "bin");
    const readyOutput = "E2E_FAKE_COMPOSE_READY";
    const isolatedTmp = join(root, "tmp");
    const downMarker = join(root, "compose-down");
    await mkdir(bin);
    await mkdir(isolatedTmp);
    await writeFile(
      join(bin, "docker"),
      `#!/bin/sh\ncase " $* " in\n  *" up "*)\n    echo "${readyOutput}"\n    trap 'exit 143' TERM INT\n    while :; do sleep 1; done\n    ;;\n  *" down "*)\n    touch "$E2E_DOWN_MARKER"\n    exit 0\n    ;;\nesac\nexit 0\n`
    );
    await writeFile(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
    await Promise.all([
      chmod(join(bin, "docker"), 0o755),
      chmod(join(bin, "pnpm"), 0o755),
    ]);

    const child = spawn(process.execPath, [script], {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        E2E_DOWN_MARKER: downMarker,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        TMPDIR: isolatedTmp,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!child.stdout) {
      throw new Error("Expected the E2E runner stdout pipe.");
    }
    await waitForOutput(child.stdout, readyOutput);
    child.kill("SIGTERM");
    const {
      promise: exitPromise,
      reject: rejectExit,
      resolve: resolveExit,
    } = Promise.withResolvers<{ code: number | null; signal: string | null }>();
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    const result = await exitPromise;
    expect(result).toEqual({ code: null, signal: "SIGTERM" });
    await expect(access(downMarker)).resolves.toBeUndefined();
    expect(
      (await readdir(isolatedTmp)).filter((entry) =>
        entry.startsWith("wizloft-e2e-")
      )
    ).toEqual([]);
  }, 15_000);
});
