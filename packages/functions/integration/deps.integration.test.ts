import { prisma } from "@repo/database";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createFunction,
  failInterruptedInstalls,
  getFunction,
  reinstallDeps,
  saveFiles,
  startRun,
} from "../src";
import type { FunctionFileInput } from "../src/definition";
import {
  type FakeRunner,
  fakeDepsKey,
  installed,
} from "../src/testing/fake-runner";
import {
  auditText,
  connectRunner,
  createOrganization,
  failureOf,
  useFakeRunner,
} from "./support";

const INDEX = {
  content: "export function main() { return 1; }",
  path: "index.ts",
};
const manifest = (version: string): FunctionFileInput => ({
  content: JSON.stringify({ dependencies: { ms: version } }),
  path: "package.json",
});

let organization: Awaited<ReturnType<typeof createOrganization>>;
let fake: FakeRunner;

beforeAll(async () => {
  organization = await createOrganization();
  fake = await useFakeRunner();
});

afterEach(() => {
  fake.reset();
  connectRunner(fake.url, fake.token);
});

afterAll(async () => {
  await organization?.cleanup();
  await fake?.close();
});

const scopeOf = (functionId: string) => ({
  functionId,
  organizationId: organization.organizationId,
});

const newFunction = async (name: string) => {
  const fn = await createFunction({
    actorId: organization.actorId,
    name,
    organizationId: organization.organizationId,
    runtime: "NODE",
  });
  return fn;
};

const save = async (functionId: string, files: FunctionFileInput[]) => {
  const current = await getFunction(scopeOf(functionId));
  return saveFiles({
    ...scopeOf(functionId),
    actorId: organization.actorId,
    expectedHash: current.sourceHash,
    files,
  });
};

/** Waits until the install the save started has finished. */
const settled = (functionId: string) =>
  vi.waitFor(
    async () => {
      const fn = await getFunction(scopeOf(functionId));
      expect(fn.depsStatus).not.toBe("BUILDING");
      return fn;
    },
    { interval: 50, timeout: 5000 }
  );

const run = (functionId: string) =>
  startRun({
    ...scopeOf(functionId),
    actorId: organization.actorId,
    params: {},
    trigger: "MANUAL",
  });

describe("installing a function's packages", () => {
  it("installs on save, refuses runs meanwhile and mounts them after", async () => {
    const fn = await newFunction("Installs on save");
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    fake.state.depsScript = async function* (request) {
      await gate;
      yield* installed(request);
    };

    const saved = await save(fn.id, [INDEX, manifest("2.1.3")]);
    expect(saved.depsStatus).toBe("BUILDING");
    const refused = await failureOf(run(fn.id));
    expect(refused.failure).toBe("DEPS_NOT_READY");
    expect(refused.message).toContain("still installing");

    finish();
    const ready = await settled(fn.id);
    const key = fakeDepsKey({
      manifests: [manifest("2.1.3")],
      runtime: "NODE",
    });
    expect(ready).toMatchObject({
      depsError: null,
      depsKey: key,
      depsLog: "added 1 package\n",
      depsStatus: "READY",
    });
    expect(ready.depsBuiltAt).not.toBeNull();

    const { completion } = await run(fn.id);
    expect((await completion).status).toBe("SUCCEEDED");
    expect(fake.state.requests.at(-1)?.depsKey).toBe(key);
  });

  it("installs again only when the manifests change", async () => {
    const fn = await newFunction("Installs on change");
    await save(fn.id, [INDEX, manifest("2.1.3")]);
    await settled(fn.id);

    await save(fn.id, [
      { ...INDEX, content: `${INDEX.content}\n// edited` },
      manifest("2.1.3"),
    ]);
    expect(fake.state.depsRequests).toHaveLength(1);
    expect((await getFunction(scopeOf(fn.id))).depsStatus).toBe("READY");

    await save(fn.id, [INDEX, manifest("2.1.2")]);
    await settled(fn.id);
    expect(fake.state.depsRequests).toHaveLength(2);

    const removed = await save(fn.id, [INDEX]);
    expect(removed).toMatchObject({
      depsHash: null,
      depsKey: null,
      depsStatus: "NONE",
    });
    const { completion } = await run(fn.id);
    await completion;
    expect(fake.state.requests.at(-1)?.depsKey).toBeUndefined();
  });

  it("stores a failed install's error and log tail, and installs again on request", async () => {
    const fn = await newFunction("Install fails");
    fake.state.depsScript = function* (request) {
      yield {
        data: `${"x".repeat(20_000)}\nnpm error 404 Not Found\n`,
        stream: "stderr",
        type: "output",
      };
      yield {
        error: "The install failed with exit code 1.",
        key: fakeDepsKey(request),
        sizeBytes: null,
        status: "FAILED",
        type: "done",
      };
    };

    await save(fn.id, [INDEX, manifest("2.1.3")]);
    const failed = await settled(fn.id);
    expect(failed).toMatchObject({
      depsError: "The install failed with exit code 1.",
      depsKey: null,
      depsStatus: "FAILED",
    });
    expect(failed.depsLog.length).toBe(16 * 1024);
    expect(failed.depsLog.endsWith("npm error 404 Not Found\n")).toBe(true);
    expect((await failureOf(run(fn.id))).failure).toBe("DEPS_NOT_READY");

    fake.state.depsScript = installed;
    const again = await reinstallDeps({
      ...scopeOf(fn.id),
      actorId: organization.actorId,
    });
    expect(again.depsStatus).toBe("BUILDING");
    expect((await settled(fn.id)).depsStatus).toBe("READY");
    expect(await auditText(organization.organizationId)).toContain(
      "function.deps.reinstalled"
    );
  });

  it("installs again when the runner evicted the packages, then runs", async () => {
    const fn = await newFunction("Evicted");
    await save(fn.id, [INDEX, manifest("2.1.3")]);
    const ready = await settled(fn.id);
    fake.state.depsEntries.clear();

    const { completion } = await run(fn.id);
    const finished = await completion;

    expect(finished.status).toBe("SUCCEEDED");
    expect(finished.output).toContain("Installing them again");
    expect(fake.state.depsRequests).toHaveLength(2);
    expect(fake.state.requests.map((request) => request.depsKey)).toEqual([
      ready.depsKey,
      ready.depsKey,
    ]);
    expect((await getFunction(scopeOf(fn.id))).depsStatus).toBe("READY");
  });

  it("marks installs a stopped server left running as failed", async () => {
    const fn = await newFunction("Interrupted");
    await prisma.codeFunction.update({
      data: { depsHash: "abc", depsStatus: "BUILDING" },
      where: { id: fn.id },
    });

    expect(await failInterruptedInstalls()).toBeGreaterThanOrEqual(1);
    expect(await getFunction(scopeOf(fn.id))).toMatchObject({
      depsStatus: "FAILED",
    });
  });
});
