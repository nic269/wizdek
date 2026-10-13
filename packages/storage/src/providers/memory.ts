import type { StorageProvider, StoredObjectBody } from "../provider";

export const createMemoryStorageProvider = (): StorageProvider => {
  const objects = new Map<string, StoredObjectBody>();

  return {
    deleteObject(input) {
      objects.delete(input.key);
      return Promise.resolve();
    },
    getObject(input) {
      const object = objects.get(input.key);
      if (!object) {
        return Promise.reject(new Error(`Object not found: ${input.key}`));
      }
      return Promise.resolve(object);
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
  };
};
