import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface TurboTask {
  env?: string[];
}

interface TurboConfig {
  envMode?: string;
  globalDependencies?: string[];
  globalEnv?: string[];
  tasks: Record<string, TurboTask>;
}

const root = resolve(import.meta.dirname, "../..");

const envKeys = (contents: string) =>
  contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")))
    .sort();

describe("Turbo environment contract", () => {
  it("uses strict mode without hashing the private env file as a global input", async () => {
    const turbo = JSON.parse(
      await readFile(resolve(root, "turbo.json"), "utf8")
    ) as TurboConfig;

    expect(turbo.envMode).toBe("strict");
    expect(turbo.globalDependencies).toEqual([
      ".env.example",
      ".env.test.example",
    ]);
    expect(turbo.globalDependencies).not.toContain(".env");
    expect(turbo.globalEnv).toEqual(["NODE_ENV", "SKIP_ENV_VALIDATION"]);
  });

  it("hashes every task-relevant onboarding variable for build and dev", async () => {
    const [turboContents, exampleContents] = await Promise.all([
      readFile(resolve(root, "turbo.json"), "utf8"),
      readFile(resolve(root, ".env.example"), "utf8"),
    ]);
    const turbo = JSON.parse(turboContents) as TurboConfig;
    const taskRelevantKeys = envKeys(exampleContents).filter(
      (key) => key !== "POSTGRES_PORT"
    );

    expect([...(turbo.tasks.build?.env ?? [])].sort()).toEqual(
      taskRelevantKeys
    );
    expect([...(turbo.tasks.dev?.env ?? [])].sort()).toEqual(taskRelevantKeys);
    expect(turbo.tasks.generate?.env).toEqual(["DATABASE_URL"]);
    expect(turbo.tasks["db:push"]?.env).toEqual(["DATABASE_URL"]);
    expect(turbo.tasks["db:migrate:dev"]?.env).toEqual(["DATABASE_URL"]);
    expect(turbo.tasks["db:migrate:deploy"]?.env).toEqual(["DATABASE_URL"]);
  });
});
