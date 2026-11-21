import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseEvictions,
  createDepsCache,
  DEPS_MAX_AGE_MS,
  depsKeyOf,
} from "./deps-cache";
import { DEPS_KEY_PATTERN } from "./protocol";

const PACKAGE = {
  content: '{"dependencies":{"ms":"2.1.3"}}',
  path: "package.json",
};
const LOCK = { content: "{}", path: "package-lock.json" };
const DAY_MS = 24 * 60 * 60 * 1000;

describe("depsKeyOf", () => {
  it("names the same manifests the same way, in any order", () => {
    const key = depsKeyOf("NODE", "wizdek-fn-node:abc", [PACKAGE, LOCK]);

    expect(key).toMatch(DEPS_KEY_PATTERN);
    expect(key.startsWith("node-")).toBe(true);
    expect(depsKeyOf("NODE", "wizdek-fn-node:abc", [LOCK, PACKAGE])).toBe(key);
  });

  it("changes with the manifests and with the runtime image", () => {
    const key = depsKeyOf("NODE", "wizdek-fn-node:abc", [PACKAGE]);

    expect(depsKeyOf("NODE", "wizdek-fn-node:abc", [PACKAGE, LOCK])).not.toBe(
      key
    );
    expect(
      depsKeyOf("NODE", "wizdek-fn-node:abc", [
        { ...PACKAGE, content: '{"dependencies":{"ms":"2.1.2"}}' },
      ])
    ).not.toBe(key);
    expect(depsKeyOf("NODE", "wizdek-fn-node:def", [PACKAGE])).not.toBe(key);
  });
});

describe("chooseEvictions", () => {
  const now = 100 * DAY_MS;
  const entries = [
    { key: "newest", lastUsedMs: now - DAY_MS, sizeBytes: 100 },
    { key: "oldest", lastUsedMs: now - 10 * DAY_MS, sizeBytes: 100 },
    { key: "middle", lastUsedMs: now - 5 * DAY_MS, sizeBytes: 100 },
    { key: "stale", lastUsedMs: now - 31 * DAY_MS, sizeBytes: 10 },
  ];

  it("removes only stale entries while there is room", () => {
    expect(
      chooseEvictions(entries, {
        freeBytes: 1000,
        inUse: new Set(),
        maxAgeMs: DEPS_MAX_AGE_MS,
        now,
        targetFreeBytes: 500,
      })
    ).toEqual(["stale"]);
  });

  it("removes least recently used entries until enough is free", () => {
    expect(
      chooseEvictions(entries, {
        freeBytes: 300,
        inUse: new Set(),
        maxAgeMs: DEPS_MAX_AGE_MS,
        now,
        targetFreeBytes: 500,
      })
    ).toEqual(["stale", "oldest", "middle"]);
  });

  it("never removes an entry in use", () => {
    expect(
      chooseEvictions(entries, {
        freeBytes: 0,
        inUse: new Set(["oldest", "stale"]),
        maxAgeMs: DEPS_MAX_AGE_MS,
        now,
        targetFreeBytes: 10_000,
      })
    ).toEqual(["middle", "newest"]);
  });
});

describe("createDepsCache", () => {
  let root: string;

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  const addEntry = async (key: string, lastUsedMs: number) => {
    await mkdir(join(root, key, "node_modules"), { recursive: true });
    const marker = join(root, key, ".complete");
    await writeFile(marker, JSON.stringify({ sizeBytes: 1 }));
    const when = new Date(lastUsedMs);
    await utimes(marker, when, when);
  };

  it("evicts unused entries but keeps one a run holds", async () => {
    root = await mkdtemp(join(tmpdir(), "deps-cache-test-"));
    const cache = createDepsCache({
      minFreeBytes: 0,
      root,
      targetFreeBytes: 0,
    });
    const now = Date.now();
    await addEntry("node-held", now - 40 * DAY_MS);
    await addEntry("node-old", now - 40 * DAY_MS);
    await addEntry("node-recent", now - DAY_MS);

    const release = cache.acquire("node-held");
    // Acquiring marks the entry used; make it old again to test the hold.
    const old = new Date(now - 40 * DAY_MS);
    await utimes(join(root, "node-held", ".complete"), old, old);

    expect(await cache.evict(now)).toEqual(["node-old"]);
    release();
    expect(await cache.evict(now)).toEqual(["node-held"]);
    expect((await readdir(root)).sort()).toEqual(["node-recent"]);
    expect(cache.readySize("node-recent")).toBe(1);
    expect(cache.readySize("node-old")).toBeNull();
  });

  it("clears installs that never finished", async () => {
    root = await mkdtemp(join(tmpdir(), "deps-cache-test-"));
    const cache = createDepsCache({
      minFreeBytes: 0,
      root,
      targetFreeBytes: 0,
    });
    await addEntry("node-done", Date.now());
    await mkdir(join(root, "node-half.tmp-abc"));
    await mkdir(join(root, "node-unmarked"));

    await cache.sweepIncomplete();

    expect(await readdir(root)).toEqual(["node-done"]);
  });
});
