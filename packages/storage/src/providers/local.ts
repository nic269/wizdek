import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { StorageProvider } from "../provider";

const PARENT_DIRECTORY_PREFIX_PATTERN = /^(\.\.(\/|\\|$))+/;

export const createLocalStorageProvider = (
  root = ".data/storage"
): StorageProvider => {
  const resolveKey = (key: string) =>
    join(root, normalize(key).replace(PARENT_DIRECTORY_PREFIX_PATTERN, ""));

  return {
    async deleteObject(input) {
      await rm(resolveKey(input.key), { force: true });
    },
    async getObject(input) {
      const body = await readFile(resolveKey(input.key));
      return {
        body,
        contentType: "application/octet-stream",
        key: input.key,
        provider: "local",
        sizeBytes: body.byteLength,
      };
    },
    async putObject(input) {
      const path = resolveKey(input.key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.body);
      return {
        contentType: input.contentType,
        key: input.key,
        provider: "local",
        sizeBytes: input.body.byteLength,
      };
    },
  };
};
