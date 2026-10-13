import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  createOrganizationJobScopeKey,
  type JobDefinition,
  type JobQueueProvider,
} from "../src";
import { createPgBossJobProvider } from "../src/providers/pg-boss";

const connectionString = process.env.DATABASE_URL as string;
const schema = `pgboss_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const providers: JobQueueProvider[] = [];
const children: ChildProcess[] = [];

const createProvider = (definitions: JobDefinition[] = []) => {
  const provider = createPgBossJobProvider({
    connectionString,
    maintenanceIntervalSeconds: 1,
    monitorIntervalSeconds: 1,
    pollingIntervalSeconds: 0.5,
    schema,
    superviseIntervalSeconds: 1,
  });
  for (const definition of definitions) {
    provider.register(definition);
  }
  providers.push(provider);
  return provider;
};

const uniqueName = (label: string) => `${label}.${randomUUID().slice(0, 8)}`;

const sleep = (milliseconds: number) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const until = async (condition: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition.");
    }
    await sleep(100);
  }
};

/** Starts a separate process whose handler hangs, and resolves once it holds a job. */
const startHangingWorker = (name: string, attempts: number) => {
  // Run as a single Node process, without a package-manager wrapper, so
  // killing the child kills the worker itself rather than only its launcher.
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve(import.meta.dirname, "hanging-worker.ts"),
      schema,
      name,
      String(attempts),
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    }
  );
  children.push(child);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  return {
    child,
    ready: () => until(() => output.includes("READY"), 30_000),
    started: () => until(() => output.includes("STARTED"), 30_000),
  };
};

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
  await Promise.all(providers.splice(0).map((provider) => provider.stop()));
});

afterAll(async () => {
  const client = new Client({ connectionString });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("pg-boss job provider", () => {
  it("runs an enqueued job and records completion", async () => {
    const name = uniqueName("email.send");
    const seen: unknown[] = [];
    const provider = createProvider([
      {
        handler: (payload, context) => {
          seen.push({ payload, runId: context.runId });
          return Promise.resolve();
        },
        name,
      },
    ]);
    await provider.start();

    const { runId } = await provider.enqueue({
      name,
      payload: { email: "user@example.com" },
    });
    await provider.waitUntilIdle();

    expect(seen).toEqual([{ payload: { email: "user@example.com" }, runId }]);
    await expect(provider.getRun(runId)).resolves.toMatchObject({
      attempts: 1,
      name,
      scopeKey: "global",
      status: "completed",
    });
    await expect(provider.listRuns()).resolves.toHaveLength(1);
  });

  it("deduplicates by idempotency key within a scope, not across scopes", async () => {
    const name = uniqueName("report.build");
    let calls = 0;
    const provider = createProvider([
      {
        handler: () => {
          calls += 1;
          return Promise.resolve();
        },
        name,
      },
    ]);
    await provider.start();
    const enqueue = (organizationId: string) =>
      provider.enqueue({
        idempotencyKey: "daily",
        name,
        payload: {},
        scopeKey: createOrganizationJobScopeKey(organizationId),
      });

    const first = await enqueue("org-1");
    const repeated = await enqueue("org-1");
    const other = await enqueue("org-2");
    await provider.waitUntilIdle();

    expect(repeated.runId).toBe(first.runId);
    expect(other.runId).not.toBe(first.runId);
    expect(calls).toBe(2);
    await expect(provider.getRun(first.runId)).resolves.toMatchObject({
      idempotencyKey: "daily",
      scopeKey: "organization:org-1",
    });
  });

  it("retries a failing job, then records the failure", async () => {
    const name = uniqueName("sync.provider");
    let calls = 0;
    const provider = createProvider([
      {
        handler: () => {
          calls += 1;
          return Promise.reject(new Error("provider unavailable"));
        },
        name,
        retry: { attempts: 2, delayMs: 0 },
      },
    ]);
    await provider.start();

    const { runId } = await provider.enqueue({ name, payload: {} });
    await provider.waitUntilIdle();

    expect(calls).toBe(2);
    await expect(provider.getRun(runId)).resolves.toMatchObject({
      attempts: 2,
      error: "provider unavailable",
      status: "failed",
    });
  });

  it("never overlaps jobs sharing a concurrency key, while other keys run in parallel", async () => {
    const name = uniqueName("flow.run");
    const active = new Map<string, number>();
    let maxPerKey = 0;
    let maxOverall = 0;
    const order: string[] = [];
    const track: JobDefinition = {
      handler: async (payload) => {
        const key = String(payload.key);
        active.set(key, (active.get(key) ?? 0) + 1);
        maxPerKey = Math.max(maxPerKey, active.get(key) ?? 0);
        maxOverall = Math.max(
          maxOverall,
          [...active.values()].reduce((sum, count) => sum + count, 0)
        );
        await sleep(700);
        order.push(`${key}${payload.sequence}`);
        active.set(key, (active.get(key) ?? 0) - 1);
      },
      name,
      serialPerKey: true,
    };
    const provider = createProvider([track]);
    // A second worker on the same queue, as a second API process would be.
    const second = createProvider([track]);
    await provider.start();
    await second.start();

    for (const sequence of [1, 2, 3]) {
      for (const key of ["a", "b"]) {
        await provider.enqueue({
          concurrencyKey: `store-${key}`,
          name,
          payload: { key, sequence },
        });
      }
    }
    await provider.waitUntilIdle();

    expect(maxPerKey).toBe(1);
    expect(maxOverall).toBe(2);
    expect(order.filter((entry) => entry.startsWith("a"))).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
    expect(order.filter((entry) => entry.startsWith("b"))).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
    await expect(
      provider.enqueue({ name, payload: { key: "a", sequence: 4 } })
    ).rejects.toThrow("needs a concurrencyKey");
  }, 30_000);

  it("releases a key after its job fails for good, and keeps the failure readable", async () => {
    const name = uniqueName("flow.fail");
    const ran: string[] = [];
    const provider = createProvider([
      {
        handler: (payload) => {
          ran.push(String(payload.step));
          return payload.step === "first"
            ? Promise.reject(new Error("flow crashed"))
            : Promise.resolve();
        },
        name,
        serialPerKey: true,
      },
    ]);
    await provider.start();

    const failed = await provider.enqueue({
      concurrencyKey: "store-1",
      name,
      payload: { step: "first" },
    });
    const next = await provider.enqueue({
      concurrencyKey: "store-1",
      name,
      payload: { step: "second" },
    });
    await provider.waitUntilIdle();

    expect(ran).toEqual(["first", "second"]);
    await expect(provider.getRun(failed.runId)).resolves.toMatchObject({
      status: "failed",
    });
    await expect(provider.getRun(next.runId)).resolves.toMatchObject({
      status: "completed",
    });
  }, 30_000);

  it("aborts the handler signal on stop and waits for the handler", async () => {
    const name = uniqueName("long.task");
    let started = false;
    let aborted = false;
    const provider = createProvider([
      {
        handler: (_payload, { signal }) =>
          new Promise<void>((_resolve, reject) => {
            started = true;
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("stopped"));
            });
          }),
        name,
        retry: { attempts: 3, delayMs: 0 },
      },
    ]);
    await provider.start();
    const { runId } = await provider.enqueue({ name, payload: {} });
    await until(() => started, 10_000);

    await provider.stop();
    expect(aborted).toBe(true);

    // The interrupted job is still owed: a fresh provider runs it again.
    let reran = false;
    const restarted = createProvider([
      {
        handler: () => {
          reran = true;
          return Promise.resolve();
        },
        name,
        retry: { attempts: 3, delayMs: 0 },
      },
    ]);
    await restarted.start();
    await until(() => reran, 15_000);
    await restarted.waitUntilIdle();
    await expect(restarted.getRun(runId)).resolves.toMatchObject({
      status: "completed",
    });
  }, 40_000);

  it("delivers a job again after its worker process dies", async () => {
    const name = uniqueName("flow.crash");
    const worker = startHangingWorker(name, 2);
    await worker.ready();

    // Enqueue through a provider that does not work the queue itself.
    const client = createPgBossJobProvider({
      connectionString,
      schema,
      workerEnabled: false,
    });
    providers.push(client);
    client.register({
      handler: () => Promise.resolve(),
      heartbeatSeconds: 10,
      name,
      retry: { attempts: 2, delayMs: 0 },
      serialPerKey: true,
    });
    await client.start();
    const { runId } = await client.enqueue({
      concurrencyKey: "store-1",
      name,
      payload: { order: 1 },
    });
    await worker.started();
    worker.child.kill("SIGKILL");

    const redelivered: string[] = [];
    const survivor = createProvider([
      {
        handler: (_payload, context) => {
          redelivered.push(context.runId);
          return Promise.resolve();
        },
        heartbeatSeconds: 10,
        name,
        retry: { attempts: 2, delayMs: 0 },
        serialPerKey: true,
      },
    ]);
    await survivor.start();
    await until(() => redelivered.length > 0, 90_000);
    await survivor.waitUntilIdle();

    expect(redelivered).toEqual([runId]);
    await expect(survivor.getRun(runId)).resolves.toMatchObject({
      attempts: 2,
      status: "completed",
    });
  }, 120_000);

  it("fires a cron schedule, including after a restart", async () => {
    const name = uniqueName("report.cron");
    const fired: unknown[] = [];
    const definition: JobDefinition = {
      handler: (payload) => {
        fired.push(payload);
        return Promise.resolve();
      },
      name,
    };
    const first = createProvider([definition]);
    await first.start();
    await first.schedule({
      cron: "* * * * *",
      key: "every-minute",
      name,
      payload: { region: "us" },
    });
    await first.stop();

    // The schedule is stored, so the next process to start picks it up.
    const restarted = createProvider([definition]);
    await restarted.start();
    await until(() => fired.length > 0, 130_000);
    expect(fired[0]).toEqual({ region: "us" });

    await restarted.unschedule(name, "every-minute");
  }, 150_000);
});
