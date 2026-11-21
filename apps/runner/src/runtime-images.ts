import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runDocker } from "./docker-cli";
import { RUNTIMES, type RuntimeId } from "./protocol";

const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const TAG_HASH_LENGTH = 12;
const ERROR_TAIL_CHARACTERS = 500;

const DIRECTORIES: Record<RuntimeId, string> = {
  NODE: "node",
  PYTHON: "python",
};

export interface RuntimeImage {
  error?: string;
  id: RuntimeId;
  image: string;
  ready: boolean;
}

export interface RuntimeImages {
  /** Builds every image whose tag is missing. Never rejects. */
  ensureAll(): Promise<void>;
  get(id: RuntimeId): RuntimeImage | undefined;
  list(): RuntimeImage[];
}

/**
 * The image tag is a hash of the runtime's directory, so a changed wrapper
 * or Dockerfile yields a new image instead of silently reusing an old one.
 */
const imageTag = async (directory: string, name: string): Promise<string> => {
  const hash = createHash("sha256");
  const files = (await readdir(directory)).sort();
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(join(directory, file)));
  }
  return `wizdek-fn-${name}:${hash.digest("hex").slice(0, TAG_HASH_LENGTH)}`;
};

export const createRuntimeImages = (runtimesDir: string): RuntimeImages => {
  const images = new Map<RuntimeId, RuntimeImage>();

  const ensure = async (id: RuntimeId): Promise<void> => {
    const name = DIRECTORIES[id];
    const directory = join(runtimesDir, name);
    let image = `wizdek-fn-${name}:unknown`;
    try {
      image = await imageTag(directory, name);
      images.set(id, { id, image, ready: false });
      const existing = await runDocker(["image", "inspect", image]);
      if (existing.code !== 0) {
        const build = await runDocker(["build", "-t", image, directory], {
          timeoutMs: BUILD_TIMEOUT_MS,
        });
        if (build.code !== 0) {
          throw new Error(build.stderr.slice(-ERROR_TAIL_CHARACTERS).trim());
        }
      }
      images.set(id, { id, image, ready: true });
    } catch (error) {
      images.set(id, {
        error: error instanceof Error ? error.message : String(error),
        id,
        image,
        ready: false,
      });
    }
  };

  return {
    async ensureAll() {
      await Promise.all(RUNTIMES.map(ensure));
    },
    get: (id) => images.get(id),
    list: () => RUNTIMES.flatMap((id) => images.get(id) ?? []),
  };
};
