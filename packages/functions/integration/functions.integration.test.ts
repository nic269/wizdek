import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFunction,
  deleteFunction,
  getFunction,
  listFunctions,
  saveFiles,
  startRun,
  updateFunction,
} from "../src";
import type { FakeRunner } from "../src/testing/fake-runner";
import {
  auditText,
  connectRunner,
  createOrganization,
  disconnectRunner,
  failureOf,
  UNREACHABLE_URL,
  useFakeRunner,
} from "./support";

const SECRET_SOURCE = "const apiKey = 'source-text-that-must-not-be-audited';";

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

const create = (name: string, runtime: "NODE" | "PYTHON" = "NODE") =>
  createFunction({
    actorId: organization.actorId,
    name,
    organizationId: organization.organizationId,
    runtime,
  });

const scope = (functionId: string) => ({
  functionId,
  organizationId: organization.organizationId,
});

describe("functions", () => {
  it("creates a function from its runtime's starter and reads its parameters", async () => {
    const created = await create("  Greeter  ");

    expect(created).toMatchObject({
      memoryMb: 256,
      name: "Greeter",
      paramsError: null,
      paramsSchema: {
        required: ["name", "times"],
        "x-order": ["name", "times"],
      },
      paramsStale: false,
      runtime: "NODE",
      timeoutSeconds: 60,
    });
    expect(created.files.map((file) => file.path)).toEqual(["index.ts"]);

    const python = await create("Python greeter", "PYTHON");
    expect(python.files.map((file) => file.path)).toEqual(["main.py"]);
    expect(
      (await listFunctions(organization.organizationId)).map((fn) => fn.name)
    ).toEqual(["Greeter", "Python greeter"]);
  });

  it("refuses a duplicate name and invalid settings", async () => {
    await create("Taken");
    expect((await failureOf(create("Taken"))).failure).toBe("NAME_TAKEN");
    expect((await failureOf(create("   "))).failure).toBe("INVALID_NAME");

    const fn = await create("Limits");
    expect(
      (
        await failureOf(
          updateFunction({
            ...scope(fn.id),
            actorId: organization.actorId,
            memoryMb: 300,
          })
        )
      ).failure
    ).toBe("INVALID_SETTINGS");
    expect(
      await updateFunction({
        ...scope(fn.id),
        actorId: organization.actorId,
        description: "  Checks limits ",
        timeoutSeconds: 120,
      })
    ).toMatchObject({ description: "Checks limits", timeoutSeconds: 120 });
  });

  it("saves several files and reopens them", async () => {
    const fn = await create("Multi file");
    const files = [
      {
        content:
          'import { greet } from "./lib/greet.ts";\nexport function main(orderId: string, limit: number) {}',
        path: "index.ts",
      },
      { content: SECRET_SOURCE, path: "lib/greet.ts" },
    ];

    const saved = await saveFiles({
      ...scope(fn.id),
      actorId: organization.actorId,
      expectedHash: fn.sourceHash,
      files,
    });

    expect(saved.sourceHash).not.toBe(fn.sourceHash);
    expect(saved.paramsSchema).toMatchObject({
      "x-order": ["orderId", "limit"],
    });
    const reopened = await getFunction(scope(fn.id));
    expect(
      reopened.files.map(({ content, path }) => ({ content, path }))
    ).toEqual(files);
    expect(await auditText(organization.organizationId)).not.toContain(
      "source-text-that-must-not-be-audited"
    );
  });

  it("refuses a save made from an older version", async () => {
    const fn = await create("Conflict");
    const first = await saveFiles({
      ...scope(fn.id),
      actorId: organization.actorId,
      expectedHash: fn.sourceHash,
      files: [{ content: "export function main() {}", path: "index.ts" }],
    });

    const error = await failureOf(
      saveFiles({
        ...scope(fn.id),
        actorId: organization.actorId,
        expectedHash: fn.sourceHash,
        files: [{ content: "lost", path: "index.ts" }],
      })
    );

    expect(error.failure).toBe("SOURCE_CONFLICT");
    expect((await getFunction(scope(fn.id))).sourceHash).toBe(first.sourceHash);
  });

  it("refuses unsafe paths and oversized files", async () => {
    const fn = await create("Unsafe");
    for (const files of [
      [{ content: "x", path: "../outside.ts" }],
      [{ content: "x".repeat(256 * 1024 + 1), path: "index.ts" }],
    ]) {
      const error = await failureOf(
        saveFiles({
          ...scope(fn.id),
          actorId: organization.actorId,
          expectedHash: fn.sourceHash,
          files,
        })
      );
      expect(error.failure).toBe("INVALID_FILES");
    }
  });

  it("stores the inspector's error without losing the files", async () => {
    const fn = await create("Broken");
    fake.state.inspect = () => ({ error: "Syntax error on line 1." });

    const saved = await saveFiles({
      ...scope(fn.id),
      actorId: organization.actorId,
      expectedHash: fn.sourceHash,
      files: [{ content: "export function main(", path: "index.ts" }],
    });

    expect(saved).toMatchObject({
      paramsError: "Syntax error on line 1.",
      paramsSchema: null,
      paramsStale: false,
    });
    expect(saved.files[0]?.content).toBe("export function main(");
  });

  it("explains a missing entry file without asking the runner", async () => {
    const fn = await create("No entry");
    const calls = fake.state.inspectCalls;

    const saved = await saveFiles({
      ...scope(fn.id),
      actorId: organization.actorId,
      expectedHash: fn.sourceHash,
      files: [{ content: "export const x = 1;", path: "other.ts" }],
    });

    expect(saved.paramsError).toContain("index.ts");
    expect(fake.state.inspectCalls).toBe(calls);
  });

  it("keeps the previous schema, flagged stale, while the runner is unreachable", async () => {
    const fn = await create("Stale");
    connectRunner(UNREACHABLE_URL, fake.token);

    const saved = await saveFiles({
      ...scope(fn.id),
      actorId: organization.actorId,
      expectedHash: fn.sourceHash,
      files: [
        {
          content: "export function main(other: boolean) {}",
          path: "index.ts",
        },
      ],
    });

    expect(saved.paramsStale).toBe(true);
    expect(saved.paramsSchema).toEqual(fn.paramsSchema);
  });

  it("still edits functions while the feature is off, but cannot run them", async () => {
    disconnectRunner();

    const fn = await create("Disabled");
    expect(fn.paramsStale).toBe(true);
    const error = await failureOf(
      startRun({
        ...scope(fn.id),
        actorId: organization.actorId,
        params: {},
        trigger: "MANUAL",
      })
    );
    expect(error.failure).toBe("FUNCTIONS_DISABLED");
  });

  it("hides another organization's functions and deletes with history", async () => {
    const other = await createOrganization();
    try {
      const fn = await create("Private");
      const error = await failureOf(
        getFunction({ functionId: fn.id, organizationId: other.organizationId })
      );
      expect(error.failure).toBe("FUNCTION_NOT_FOUND");

      await deleteFunction({ ...scope(fn.id), actorId: organization.actorId });
      expect((await failureOf(getFunction(scope(fn.id)))).failure).toBe(
        "FUNCTION_NOT_FOUND"
      );
    } finally {
      await other.cleanup();
    }
  });
});
