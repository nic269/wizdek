import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
    async getObjectStream(input) {
      const path = resolveKey(input.key);
      const { size } = await stat(path);
      return {
        body: createReadStream(path),
        contentType: "application/octet-stream",
        key: input.key,
        provider: "local",
        sizeBytes: size,
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
    async putObjectStream(input) {
      const path = resolveKey(input.key);
      // Written beside the target and renamed into place, so a reader never
      // sees a half-written object.
      const partialPath = `${path}.partial`;
      await mkdir(dirname(path), { recursive: true });
      let sizeBytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.byteLength;
          callback(null, chunk);
        },
      });
      try {
        await pipeline(input.body, counter, createWriteStream(partialPath));
        await rename(partialPath, path);
      } catch (error) {
        await rm(partialPath, { force: true });
        throw error;
      }
      return {
        contentType: input.contentType,
        key: input.key,
        provider: "local",
        sizeBytes,
      };
    },
  };
};
