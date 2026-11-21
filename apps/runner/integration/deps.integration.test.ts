import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AUTHORIZED, createTestAgent, TOKEN } from "./support";

const SETUP_TIMEOUT_MS = 600_000;
const INSTALL_TIMEOUT_MS = 240_000;

/**
 * Installs `ms` and, through the project's own preinstall script, records
 * the environment the install ran with.
 */
const packageJson = (version: string) =>
  JSON.stringify({
    dependencies: { ms: version },
    name: "fn",
    scripts: { preinstall: "env > /deps/install-env.txt" },
  });

let agent: Awaited<ReturnType<typeof createTestAgent>>;

beforeAll(async () => {
  agent = await createTestAgent();
}, SETUP_TIMEOUT_MS);

describe("installing packages", () => {
  it(
    "installs npm packages that a Node function then imports",
    async () => {
      const manifests = [
        { content: packageJson("2.1.3"), path: "package.json" },
      ];
      const { done, output } = await agent.install({
        manifests,
        runtime: "NODE",
      });

      expect(done).toMatchObject({ status: "READY" });
      expect(done.sizeBytes).toBeGreaterThan(0);
      expect(output).not.toBe("");

      // The install saw none of the agent's settings.
      const installEnv = await readFile(
        join(agent.cache.pathOf(done.key), "install-env.txt"),
        "utf8"
      );
      expect(installEnv).not.toContain(TOKEN);
      expect(installEnv).not.toContain("RUNNER_");

      const { exit, stderr } = await agent.run({
        depsKey: done.key,
        files: [
          {
            content: `
              import ms from "ms";
              export function main() { return ms("2h"); }
            `,
            path: "index.ts",
          },
          { content: packageJson("2.1.3"), path: "package.json" },
        ],
        runtime: "NODE",
      });
      expect(exit).toMatchObject({ result: 7_200_000, status: "SUCCEEDED" });
      expect(stderr).toBe("");

      // The same manifests answer at once, without a container.
      const again = await agent.install({ manifests, runtime: "NODE" });
      expect(again.events.at(-1)).toEqual(done);
      expect(again.output).toContain("installed earlier");

      const changed = await agent.install({
        manifests: [{ content: packageJson("2.1.2"), path: "package.json" }],
        runtime: "NODE",
      });
      expect(changed.done.status).toBe("READY");
      expect(changed.done.key).not.toBe(done.key);
    },
    INSTALL_TIMEOUT_MS
  );

  it(
    "installs PyPI packages that a Python function then imports",
    async () => {
      const { done } = await agent.install({
        manifests: [{ content: "six==1.16.0\n", path: "requirements.txt" }],
        runtime: "PYTHON",
      });
      expect(done).toMatchObject({ status: "READY" });

      const { exit } = await agent.run({
        depsKey: done.key,
        files: [
          {
            content: "import six\n\ndef main():\n    return six.__version__\n",
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });
      expect(exit).toMatchObject({ result: "1.16.0", status: "SUCCEEDED" });
    },
    INSTALL_TIMEOUT_MS
  );

  it(
    "reports a failed install with its output and keeps nothing",
    async () => {
      const { done, output } = await agent.install({
        manifests: [
          {
            content: "wizdek-package-that-does-not-exist-0f3a==1.0\n",
            path: "requirements.txt",
          },
        ],
        runtime: "PYTHON",
      });

      expect(done).toMatchObject({ sizeBytes: null, status: "FAILED" });
      expect(output).toContain("wizdek-package-that-does-not-exist-0f3a");
      expect(agent.cache.readySize(done.key)).toBeNull();
    },
    INSTALL_TIMEOUT_MS
  );

  it(
    "discards an install larger than the size limit",
    async () => {
      const small = await createTestAgent({ depsMaxBytes: 1024 });
      const { done } = await small.install({
        manifests: [{ content: packageJson("2.1.3"), path: "package.json" }],
        runtime: "NODE",
      });

      expect(done).toMatchObject({ sizeBytes: null, status: "FAILED" });
      expect(done.error).toContain("limit");
      expect(
        await readdir(join(small.workDir, "deps")).catch(() => [])
      ).toEqual([]);
    },
    INSTALL_TIMEOUT_MS
  );

  it("refuses a run whose packages are not installed", async () => {
    const response = await agent.app.request("/runs", {
      body: JSON.stringify({
        depsKey: `node-${"0".repeat(32)}`,
        files: [{ content: "export const main = () => 1;", path: "index.ts" }],
        memoryMb: 256,
        runId: "test_no_deps",
        runtime: "NODE",
        timeoutSeconds: 10,
      }),
      headers: AUTHORIZED,
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DEPS_MISSING" });
  });
});
