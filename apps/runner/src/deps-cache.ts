import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeId } from "./protocol";

const KEY_HASH_LENGTH = 32;
const MARKER = ".complete";
const TEMP_INFIX = ".tmp-";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Entries nobody has used for this long are removed. */
export const DEPS_MAX_AGE_MS = 30 * DAY_MS;
/** The user sandbox containers run as. */
export const SANDBOX_UID = 10_001;

/** Where an entry's installed packages are mounted inside a run. */
export const DEPS_MOUNTS: Record<
  RuntimeId,
  { directory: string; target: string; env?: string }
> = {
  NODE: { directory: "node_modules", target: "/fn/node_modules" },
  PYTHON: { directory: "site", env: "PYTHONPATH=/deps", target: "/deps" },
};

export interface Manifest {
  content: string;
  path: string;
}

/**
 * Names the cache entry for a set of manifests. The runtime image is part of
 * the key, so a new base image installs native modules again instead of
 * reusing ones built against the old one.
 */
export const depsKeyOf = (
  runtime: RuntimeId,
  image: string,
  manifests: readonly Manifest[]
): string => {
  const hash = createHash("sha256").update(`${runtime}\0${image}\0`);
  for (const manifest of [...manifests].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    hash.update(`${manifest.path}\0${manifest.content}\0`);
  }
  return `${runtime.toLowerCase()}-${hash.digest("hex").slice(0, KEY_HASH_LENGTH)}`;
};

export interface CacheEntry {
  key: string;
  lastUsedMs: number;
  sizeBytes: number;
}

/**
 * Which entries to remove: every entry unused for `maxAgeMs`, then the least
 * recently used ones until free space reaches `targetFreeBytes`. Entries in
 * use are never chosen.
 */
export const chooseEvictions = (
  entries: readonly CacheEntry[],
  options: {
    freeBytes: number;
    inUse: ReadonlySet<string>;
    maxAgeMs: number;
    now: number;
    targetFreeBytes: number;
  }
): string[] => {
  const candidates = entries
    .filter((entry) => !options.inUse.has(entry.key))
    .sort((a, b) => a.lastUsedMs - b.lastUsedMs);
  const chosen: string[] = [];
  let free = options.freeBytes;
  for (const entry of candidates) {
    const stale = options.now - entry.lastUsedMs > options.maxAgeMs;
    if (stale || free < options.targetFreeBytes) {
      chosen.push(entry.key);
      free += entry.sizeBytes;
    }
  }
  return chosen;
};

/** Bytes used by the files under a directory, without following links. */
export const directorySize = async (path: string): Promise<number> => {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child);
    } else {
      total += (await lstat(child)).size;
    }
  }
  return total;
};

export interface DepsCacheConfig {
  /** Free disk below which installs are refused. */
  minFreeBytes: number;
  root: string;
  /** Free disk eviction tries to restore. */
  targetFreeBytes: number;
}

export interface DepsCache {
  /** Marks an entry in use until the returned function is called. */
  acquire(key: string): () => void;
  /** Moves a finished install into place and records its size. */
  commit(temp: string, key: string, sizeBytes: number): Promise<void>;
  /** A new directory for an install, writable by the install's user. */
  createTemp(key: string, owner: number | null): Promise<string>;
  /** Removes unused entries; returns the keys removed. */
  evict(now?: number): Promise<string[]>;
  freeBytes(): Promise<number>;
  pathOf(key: string): string;
  /** The entry's size when it is complete, otherwise null. */
  readySize(key: string): number | null;
  /** Removes installs a stopped agent left half done. */
  sweepIncomplete(): Promise<void>;
}

export const createDepsCache = (config: DepsCacheConfig): DepsCache => {
  const users = new Map<string, number>();
  const pathOf = (key: string) => join(config.root, key);
  const markerOf = (key: string) => join(pathOf(key), MARKER);

  const freeBytes = async () => {
    await mkdir(config.root, { recursive: true });
    const stats = await statfs(config.root);
    return stats.bavail * stats.bsize;
  };

  const listEntries = async (): Promise<CacheEntry[]> => {
    const names = await readdir(config.root).catch(() => [] as string[]);
    const entries: CacheEntry[] = [];
    for (const key of names) {
      if (key.includes(TEMP_INFIX)) {
        continue;
      }
      try {
        const marker = await stat(markerOf(key));
        const { sizeBytes } = JSON.parse(
          readFileSync(markerOf(key), "utf8")
        ) as { sizeBytes: number };
        entries.push({ key, lastUsedMs: marker.mtimeMs, sizeBytes });
      } catch {
        // Not a complete entry; `sweepIncomplete` handles leftovers.
      }
    }
    return entries;
  };

  return {
    acquire(key) {
      users.set(key, (users.get(key) ?? 0) + 1);
      const now = new Date();
      utimes(markerOf(key), now, now).catch(() => undefined);
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const count = (users.get(key) ?? 1) - 1;
        if (count > 0) {
          users.set(key, count);
        } else {
          users.delete(key);
        }
      };
    },
    async commit(temp, key, sizeBytes) {
      await writeFile(
        join(temp, MARKER),
        JSON.stringify({ builtAt: new Date().toISOString(), sizeBytes })
      );
      try {
        await rename(temp, pathOf(key));
      } catch (error) {
        // Another install of the same manifests finished first.
        await rm(temp, { force: true, recursive: true });
        if (!existsSync(markerOf(key))) {
          throw error;
        }
      }
    },
    async createTemp(key, owner) {
      await mkdir(config.root, { recursive: true });
      const temp = join(
        config.root,
        `${key}${TEMP_INFIX}${randomBytes(6).toString("hex")}`
      );
      await mkdir(temp);
      await chmod(temp, 0o755);
      if (owner !== null) {
        await chown(temp, owner, owner);
      }
      return temp;
    },
    async evict(now = Date.now()) {
      const chosen = chooseEvictions(await listEntries(), {
        freeBytes: await freeBytes(),
        inUse: new Set(users.keys()),
        maxAgeMs: DEPS_MAX_AGE_MS,
        now,
        targetFreeBytes: config.targetFreeBytes,
      });
      const removed: string[] = [];
      for (const key of chosen) {
        // A run may have started using it since the list was made.
        if (users.has(key)) {
          continue;
        }
        // The marker goes first, so a half-removed entry is never mounted.
        await rm(markerOf(key), { force: true });
        await rm(pathOf(key), { force: true, recursive: true });
        removed.push(key);
      }
      return removed;
    },
    freeBytes,
    pathOf,
    readySize(key) {
      try {
        const { sizeBytes } = JSON.parse(
          readFileSync(markerOf(key), "utf8")
        ) as { sizeBytes: number };
        return sizeBytes;
      } catch {
        return null;
      }
    },
    async sweepIncomplete() {
      const names = await readdir(config.root).catch(() => [] as string[]);
      for (const name of names) {
        if (name.includes(TEMP_INFIX) || !existsSync(markerOf(name))) {
          await rm(join(config.root, name), { force: true, recursive: true });
        }
      }
    },
  };
};
