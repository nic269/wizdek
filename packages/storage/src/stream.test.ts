import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { createLocalStorageProvider } from "./providers/local";
import { createMemoryStorageProvider } from "./providers/memory";

const MIB = 1024 * 1024;

const failingStream = () =>
  new Readable({
    read() {
      this.push(Buffer.from("first chunk"));
      this.destroy(new Error("source failed"));
    },
  });

/** Yields `totalBytes` of generated data without ever holding it all. */
const generatedStream = (totalBytes: number) => {
  const chunk = Buffer.alloc(MIB, 7);
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= totalBytes) {
        this.push(null);
        return;
      }
      sent += chunk.byteLength;
      this.push(chunk);
    },
  });
};

const listFiles = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

describe("local storage streams", () => {
  it("round-trips a stream and reports the written size", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-stream-"));
    const storage = createLocalStorageProvider(root);

    const stored = await storage.putObjectStream({
      body: Readable.from(["hello ", "stream"]),
      contentType: "text/plain",
      key: "org/acme/greeting.txt",
    });
    expect(stored).toMatchObject({ provider: "local", sizeBytes: 12 });
    await expect(
      readFile(join(root, "org/acme/greeting.txt"), "utf8")
    ).resolves.toBe("hello stream");

    const read = await storage.getObjectStream({
      key: "org/acme/greeting.txt",
    });
    expect(read.sizeBytes).toBe(12);
    await expect(text(read.body)).resolves.toBe("hello stream");
  });

  it("leaves nothing behind when the source fails midway", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-stream-"));
    const storage = createLocalStorageProvider(root);

    await expect(
      storage.putObjectStream({
        body: failingStream(),
        contentType: "application/octet-stream",
        key: "org/acme/broken.dump",
      })
    ).rejects.toThrow("source failed");
    await expect(listFiles(root)).resolves.toEqual([]);
  });

  it("keeps keys with parent segments inside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-stream-"));
    const storage = createLocalStorageProvider(root);

    await storage.putObjectStream({
      body: Readable.from(["x"]),
      contentType: "text/plain",
      key: "../../escape.txt",
    });
    await expect(listFiles(root)).resolves.toEqual([join(root, "escape.txt")]);
  });

  it("writes an object far larger than the memory it uses", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-stream-"));
    const storage = createLocalStorageProvider(root);
    const totalBytes = 256 * MIB;
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 5);

    try {
      const stored = await storage.putObjectStream({
        body: generatedStream(totalBytes),
        contentType: "application/octet-stream",
        key: "org/acme/large.bin",
      });
      expect(stored.sizeBytes).toBe(totalBytes);
    } finally {
      clearInterval(sampler);
    }

    // Buffering the object would grow the process by its full size.
    expect(peak - baseline).toBeLessThan(totalBytes / 2);
  });
});

describe("memory storage streams", () => {
  it("round-trips a stream", async () => {
    const storage = createMemoryStorageProvider();

    const stored = await storage.putObjectStream({
      body: Readable.from(["in ", "memory"]),
      contentType: "text/plain",
      key: "k",
    });
    expect(stored.sizeBytes).toBe(9);
    const read = await storage.getObjectStream({ key: "k" });
    await expect(text(read.body)).resolves.toBe("in memory");
  });

  it("stores nothing when the source fails", async () => {
    const storage = createMemoryStorageProvider();

    await expect(
      storage.putObjectStream({
        body: failingStream(),
        contentType: "application/octet-stream",
        key: "k",
      })
    ).rejects.toThrow("source failed");
    await expect(storage.getObjectStream({ key: "k" })).rejects.toThrow(
      "Object not found"
    );
  });
});
