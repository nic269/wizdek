import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITS } from "../src/protocol";
import {
  AUTHORIZED,
  createTestAgent,
  leftoverContainers,
  readRun,
  TOKEN,
} from "./support";

const SETUP_TIMEOUT_MS = 600_000;
const RUN_TIMEOUT_MS = 120_000;

let agent: Awaited<ReturnType<typeof createTestAgent>>;

beforeAll(async () => {
  agent = await createTestAgent();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  expect(await leftoverContainers()).toEqual([]);
  expect(await readdir(join(agent.workDir, "runs")).catch(() => [])).toEqual(
    []
  );
});

describe("running a function", () => {
  it(
    "runs a TypeScript function made of two files",
    async () => {
      const { exit, stderr, stdout } = await agent.run({
        files: [
          {
            content: `
              import { greet } from "./lib/greet.ts";
              export async function main(name: string, times: number = 1) {
                console.log("to stdout");
                console.error("to stderr");
                return { greeting: greet(name).repeat(times) };
              }
            `,
            path: "index.ts",
          },
          {
            content:
              'export const greet = (name: string) => "hi " + name + ";";',
            path: "lib/greet.ts",
          },
        ],
        paramOrder: ["name", "times"],
        params: { name: "ada", times: 2 },
        runtime: "NODE",
      });

      expect(exit).toMatchObject({
        exitCode: 0,
        oomKilled: false,
        result: { greeting: "hi ada;hi ada;" },
        status: "SUCCEEDED",
        truncated: false,
      });
      expect(stdout).toBe("to stdout\n");
      expect(stderr).toBe("to stderr\n");
    },
    RUN_TIMEOUT_MS
  );

  it(
    "runs a Python function made of two files",
    async () => {
      const { exit, stdout } = await agent.run({
        files: [
          {
            content: [
              "from helper import double",
              "",
              "async def main(order_id: str, limit: int = 10):",
              "    print('checking', order_id)",
              "    return {'order': order_id, 'limit': double(limit)}",
            ].join("\n"),
            path: "main.py",
          },
          { content: "def double(n):\n    return n * 2\n", path: "helper.py" },
        ],
        params: { limit: 4, order_id: "#1001" },
        runtime: "PYTHON",
      });

      expect(exit).toMatchObject({
        exitCode: 0,
        result: { limit: 8, order: "#1001" },
        status: "SUCCEEDED",
      });
      expect(stdout).toBe("checking #1001\n");
    },
    RUN_TIMEOUT_MS
  );

  it(
    "reports an uncaught error with its trace",
    async () => {
      const node = await agent.run({
        files: [
          {
            content: "export function main() { throw new Error('boom'); }",
            path: "index.ts",
          },
        ],
        runtime: "NODE",
      });
      expect(node.exit).toMatchObject({
        error: "boom",
        exitCode: 1,
        status: "FAILED",
      });
      expect(node.stderr).toContain("Error: boom");
      expect(node.stderr).toContain("index.ts");

      const python = await agent.run({
        files: [
          {
            content: "def main():\n    raise ValueError('bad input')\n",
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });
      expect(python.exit).toMatchObject({
        error: "ValueError: bad input",
        exitCode: 1,
        status: "FAILED",
      });
      expect(python.stderr).toContain("Traceback");
    },
    RUN_TIMEOUT_MS
  );

  it(
    "refuses a value that is not JSON",
    async () => {
      const { exit } = await agent.run({
        files: [
          { content: "export const main = () => 10n;", path: "index.ts" },
        ],
        runtime: "NODE",
      });

      expect(exit.status).toBe("FAILED");
      expect(exit.error).toContain("not JSON");
    },
    RUN_TIMEOUT_MS
  );
});

describe("limits", () => {
  it(
    "stops a function at its timeout",
    async () => {
      const { exit } = await agent.run({
        files: [
          {
            content: "export function main() { for (;;) {} }",
            path: "index.ts",
          },
        ],
        runtime: "NODE",
        timeoutSeconds: 3,
      });

      expect(exit.status).toBe("TIMED_OUT");
      expect(exit.error).toBe("The function timed out after 3 seconds.");
      expect(exit.durationMs).toBeLessThan(30_000);
    },
    RUN_TIMEOUT_MS
  );

  it(
    "stops a function when the run is canceled",
    async () => {
      const { response, runId } = agent.start({
        files: [
          {
            content: "def main():\n    while True:\n        pass\n",
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });
      await delay(4000);

      const canceled = await agent.app.request(`/runs/${runId}`, {
        headers: AUTHORIZED,
        method: "DELETE",
      });
      const { exit } = await readRun(await response);

      expect(canceled.status).toBe(204);
      expect(exit.status).toBe("CANCELED");
    },
    RUN_TIMEOUT_MS
  );

  it(
    "kills a function that exceeds its memory limit",
    async () => {
      const { exit } = await agent.run({
        files: [
          {
            content: `
              export function main() {
                const held = [];
                for (;;) {
                  held.push(Buffer.alloc(32 * 1024 * 1024, 1));
                }
              }
            `,
            path: "index.js",
          },
        ],
        memoryMb: 128,
        runtime: "NODE",
      });

      expect(exit).toMatchObject({
        error: "The function exceeded its 128 MB memory limit.",
        oomKilled: true,
        status: "FAILED",
      });
    },
    RUN_TIMEOUT_MS
  );

  it(
    "cuts output at the limit and still returns the result",
    async () => {
      const { exit, stdout } = await agent.run({
        files: [
          {
            content: [
              "def main():",
              "    line = 'x' * 1023",
              "    for _ in range(5 * 1024):",
              "        print(line)",
              "    return 'done'",
            ].join("\n"),
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });

      expect(exit).toMatchObject({
        result: "done",
        status: "SUCCEEDED",
        truncated: true,
      });
      expect(Buffer.byteLength(stdout)).toBe(LIMITS.outputBytes);
    },
    RUN_TIMEOUT_MS
  );
});

describe("isolation", () => {
  it(
    "runs as an unprivileged user on a read-only filesystem with only the passed variables",
    async () => {
      const { exit } = await agent.run({
        env: { API_KEY: "value-for-the-function" },
        files: [
          {
            content: [
              "import os",
              "",
              "def attempt(path):",
              "    try:",
              "        with open(path, 'w') as handle:",
              "            handle.write('x')",
              "        return 'written'",
              "    except OSError as error:",
              "        return type(error).__name__",
              "",
              "def main():",
              "    with open('/proc/1/environ', 'rb') as handle:",
              "        init_environment = handle.read().decode()",
              "    return {",
              "        'uid': os.getuid(),",
              "        'api_key': os.environ.get('API_KEY'),",
              "        'names': sorted(os.environ),",
              "        'init_environment': init_environment,",
              "        'source': attempt('/fn/main.py'),",
              "        'system': attempt('/etc/planted'),",
              "        'tmp': attempt('/tmp/scratch'),",
              "    }",
            ].join("\n"),
            path: "main.py",
          },
        ],
        runtime: "PYTHON",
      });

      expect(exit.status).toBe("SUCCEEDED");
      const result = exit.result as {
        api_key: string;
        init_environment: string;
        names: string[];
        source: string;
        system: string;
        tmp: string;
        uid: number;
      };
      expect(result.uid).toBe(10_001);
      expect(result.api_key).toBe("value-for-the-function");
      expect(result.source).not.toBe("written");
      expect(result.system).not.toBe("written");
      expect(result.tmp).toBe("written");
      expect(result.names.filter((name) => name.startsWith("RUNNER_"))).toEqual(
        []
      );
      expect(result.init_environment).not.toContain(TOKEN);
      expect(result.init_environment).not.toContain("RUNNER_");
      // The variable is set by the wrapper, not on the container.
      expect(result.init_environment).not.toContain("value-for-the-function");
    },
    RUN_TIMEOUT_MS
  );
});

describe("refusals", () => {
  const body = JSON.stringify({
    files: [{ content: "export const main = () => 1;", path: "index.ts" }],
    memoryMb: 256,
    runId: "test_refusal",
    runtime: "NODE",
    timeoutSeconds: 10,
  });

  it("requires the token on every route but health", async () => {
    const health = await agent.app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      runtimes: [
        { id: "NODE", ready: true },
        { id: "PYTHON", ready: true },
      ],
    });

    for (const headers of [
      { "content-type": "application/json" },
      { authorization: "Bearer wrong", "content-type": "application/json" },
    ]) {
      const response = await agent.app.request("/runs", {
        body,
        headers,
        method: "POST",
      });
      expect(response.status).toBe(401);
    }
  });

  it("refuses a run without an entry file", async () => {
    const response = await agent.app.request("/runs", {
      body: JSON.stringify({
        ...JSON.parse(body),
        files: [{ content: "x = 1", path: "other.ts" }],
      }),
      headers: AUTHORIZED,
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "NO_ENTRY_FILE" });
  });

  it("answers busy when the memory budget is spent", async () => {
    const small = await createTestAgent(512);
    const response = await small.app.request("/runs", {
      body: JSON.stringify({ ...JSON.parse(body), memoryMb: 1024 }),
      headers: AUTHORIZED,
      method: "POST",
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "BUSY" });
  });

  it("answers 404 when canceling a run that is not active", async () => {
    const response = await agent.app.request("/runs/test_unknown", {
      headers: AUTHORIZED,
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });
});
