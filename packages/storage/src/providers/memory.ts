import { Readable } from "node:stream";
import type { StorageProvider, StoredObjectBody } from "../provider";

export const createMemoryStorageProvider = (): StorageProvider => {
  const objects = new Map<string, StoredObjectBody>();

  const find = (key: string) => {
    const object = objects.get(key);
    if (!object) {
      return Promise.reject(new Error(`Object not found: ${key}`));
    }
    return Promise.resolve(object);
  };

  return {
    deleteObject(input) {
      objects.delete(input.key);
      return Promise.resolve();
    },
    getObject(input) {
      return find(input.key);
    },
    async getObjectStream(input) {
      const { body, ...object } = await find(input.key);
      return { ...object, body: Readable.from([body]) };
    },
    putObject(input) {
      const stored = {
        body: input.body,
        contentType: input.contentType,
        key: input.key,
        provider: "memory",
        sizeBytes: input.body.byteLength,
      };
      objects.set(input.key, stored);
      return Promise.resolve(stored);
    },
    async putObjectStream(input) {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body) {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
      const body = new Uint8Array(Buffer.concat(chunks));
      const stored = {
        contentType: input.contentType,
        key: input.key,
        provider: "memory",
        sizeBytes: body.byteLength,
      };
      objects.set(input.key, { ...stored, body });
      return stored;
    },
  };
};
