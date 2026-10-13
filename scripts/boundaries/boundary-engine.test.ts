import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBoundaries } from "./boundary-engine.ts";

const roots: string[] = [];

const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const workspace = async (input: {
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
  kind: "apps" | "packages";
  name: string;
  root: string;
  source: string;
}) => {
  const slug = input.name.split("/").at(-1) ?? input.name;
  const directory = join(input.root, input.kind, slug);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeJson(join(directory, "package.json"), {
    dependencies: input.dependencies,
    exports: input.exports,
    name: input.name,
  });
  await writeFile(join(directory, "src/index.ts"), input.source);
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("boundary engine", () => {
  it("reports source, export, layer, client, declaration, and cycle violations", async () => {
    const root = await mkdtemp(join(tmpdir(), "boundaries-"));
    roots.push(root);
    const configPath = join(root, "boundaries.config.json");
    await writeJson(configPath, {
      clientSafeEntrypoints: { "@repo/server": ["./client"] },
      packageRules: { "@repo/ui": [] },
    });
    await workspace({
      kind: "apps",
      name: "@repo/app-a",
      root,
      source: 'import "@repo/app-b";\n',
    });
    await workspace({ kind: "apps", name: "@repo/app-b", root, source: "" });
    await workspace({
      dependencies: {
        "@repo/app-b": "workspace:*",
        "@repo/server": "workspace:*",
      },
      exports: { ".": "./src/index.ts" },
      kind: "packages",
      name: "@repo/ui",
      root,
      source:
        '"use client";\nimport "@repo/app-b";\nimport "@repo/server/private";\nimport "../../server/src/index";\n',
    });
    await workspace({
      dependencies: { "@repo/ui": "workspace:*" },
      exports: { ".": "./src/index.ts", "./client": "./src/client.ts" },
      kind: "packages",
      name: "@repo/server",
      root,
      source: 'import "@repo/ui";\n',
    });
    await workspace({
      dependencies: { "@repo/server": "workspace:*" },
      exports: { ".": "./src/index.ts" },
      kind: "packages",
      name: "@repo/loose",
      root,
      source: 'import "@repo/server";\n',
    });

    const violations = await checkBoundaries({ configPath, root });
    expect(new Set(violations.map(({ code }) => code))).toEqual(
      new Set([
        "app-imports-app",
        "client-imports-server",
        "cross-workspace-relative-import",
        "dependency-cycle",
        "layer-violation",
        "package-imports-app",
        "private-deep-import",
        "unconfigured-package",
        "undeclared-workspace-dependency",
      ])
    );
  });

  it("accepts public client entrypoints and declared package layers", async () => {
    const root = await mkdtemp(join(tmpdir(), "boundaries-"));
    roots.push(root);
    const configPath = join(root, "boundaries.config.json");
    await writeJson(configPath, {
      clientSafeEntrypoints: { "@repo/server": ["./client"] },
      packageRules: { "@repo/ui": ["@repo/server"] },
    });
    await workspace({
      dependencies: { "@repo/server": "workspace:*" },
      exports: { ".": "./src/index.ts" },
      kind: "packages",
      name: "@repo/ui",
      root,
      source: '"use client";\nimport "@repo/server/client";\n',
    });
    await workspace({
      exports: { ".": "./src/index.ts", "./client": "./src/client.ts" },
      kind: "packages",
      name: "@repo/server",
      root,
      source: "",
    });

    await expect(checkBoundaries({ configPath, root })).resolves.toEqual([]);
  });
  it("checks external imports with exact file exceptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "boundaries-"));
    roots.push(root);
    const configPath = join(root, "boundaries.config.json");
    await writeJson(configPath, {
      clientSafeEntrypoints: {},
      forbiddenImportExceptions: {
        "@repo/domain": {
          "src/index.ts": ["@prisma/client", "next"],
        },
      },
      forbiddenPackageImports: {
        "@repo/domain": ["@prisma/client", "next", "next/server"],
      },
      packageRules: { "@repo/domain": [] },
    });
    await workspace({
      kind: "packages",
      name: "@repo/domain",
      root,
      source:
        'import "@prisma/client/runtime";\nimport "next/server";\nimport "nextish";\n',
    });

    const violations = await checkBoundaries({ configPath, root });
    expect(
      violations.filter(({ code }) => code === "forbidden-package-import")
    ).toEqual([
      expect.objectContaining({
        file: "packages/domain/src/index.ts",
        message: expect.stringContaining("next/server"),
      }),
    ]);
  });

  it("rejects malformed and broad exception paths before inspection", async () => {
    const root = await mkdtemp(join(tmpdir(), "boundaries-"));
    roots.push(root);
    const configPath = join(root, "boundaries.config.json");
    await writeJson(configPath, {
      clientSafeEntrypoints: {},
      forbiddenImportExceptions: {
        "@repo/domain": { "src/**": ["next"] },
      },
      forbiddenPackageImports: { "@repo/domain": ["next"] },
      packageRules: { "@repo/domain": [] },
    });
    await workspace({
      kind: "packages",
      name: "@repo/domain",
      root,
      source: "",
    });

    await expect(checkBoundaries({ configPath, root })).rejects.toThrow(
      "Invalid forbidden import exception path"
    );
  });

  it("rejects forbidden import rules for an unknown owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "boundaries-"));
    roots.push(root);
    const configPath = join(root, "boundaries.config.json");
    await writeJson(configPath, {
      clientSafeEntrypoints: {},
      forbiddenPackageImports: { "@repo/missing": ["next"] },
      packageRules: {},
    });

    await expect(checkBoundaries({ configPath, root })).rejects.toThrow(
      "Forbidden import rules have unknown owner @repo/missing"
    );
  });
});
