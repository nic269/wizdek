import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "check-dev-migrations.mjs");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

const runWithMigrationStatus = async (status: number) => {
  const root = await mkdtemp(join(tmpdir(), "migration-preflight-"));
  roots.push(root);
  const pnpm = join(root, "pnpm");
  await writeFile(pnpm, `#!/bin/sh\nexit ${status}\n`);
  await chmod(pnpm, 0o755);
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${root}${delimiter}${process.env.PATH}` },
  });
};

describe("development migration preflight", () => {
  it("allows development startup when migration status is clean", async () => {
    const result = await runWithMigrationStatus(0);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("blocks startup and preserves the migration status exit code", async () => {
    const result = await runWithMigrationStatus(7);

    expect(result.status).toBe(7);
    expect(result.stderr).toContain("Database migrations are not ready");
    expect(result.stderr).toContain("pnpm db:migrate:deploy");
  });
});
