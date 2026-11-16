import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Vault } from "../../server/profiles/crypto";
import { ControlStore } from "../../server/storage/control-store";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 8).toString("base64");

describe("Vault", () => {
  it("round-trips only with the original key and purpose", () => {
    const vault = new Vault(KEY);
    const ciphertext = vault.seal({ password: "secret" }, "profile:test:1");

    expect(vault.open(ciphertext, "profile:test:1")).toEqual({
      password: "secret",
    });
    expect(() => vault.open(ciphertext, "profile:test:2")).toThrowError(
      expect.objectContaining({ code: "vault_unavailable" })
    );
    expect(() =>
      new Vault(OTHER_KEY).open(ciphertext, "profile:test:1")
    ).toThrowError(expect.objectContaining({ code: "vault_unavailable" }));
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => new Vault(Buffer.alloc(31).toString("base64"))).toThrowError(
      expect.objectContaining({ code: "vault_key_invalid" })
    );
  });
});

describe("ControlStore ownership and restart", () => {
  const roots: string[] = [];
  const stores: ControlStore[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const store of stores.splice(0)) {
      try {
        store.close();
      } catch {
        // A constructor failure may already have closed the database.
      }
    }
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  const createPath = () => {
    const root = mkdtempSync(join(tmpdir(), "oms-control-store-"));
    roots.push(root);
    return join(root, "control.sqlite");
  };

  it("rejects a second owner while the first instance is live", () => {
    const path = createPath();
    const first = new ControlStore(path, KEY);
    stores.push(first);

    expect(() => new ControlStore(path, KEY)).toThrowError(
      expect.objectContaining({ code: "control_store_owned" })
    );
  });

  it("recovers after a dev process is killed, retaining committed data", () => {
    vi.stubEnv("NODE_ENV", "development");
    const path = createPath();
    const modulePath = resolve(
      "app/works/oms-management/_module/server/storage/control-store.ts"
    );
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { ControlStore } from ${JSON.stringify(modulePath)};
       const store = new ControlStore(${JSON.stringify(path)}, ${JSON.stringify(KEY)});
       store.db.prepare("INSERT INTO metadata VALUES ('crash-fixture', 'retained')").run();
       process.kill(process.pid, "SIGKILL");`,
      ],
      { env: { ...process.env, NODE_ENV: "development" } }
    );
    expect(child.signal, child.stderr.toString()).toBe("SIGKILL");
    const restarted = new ControlStore(path, KEY);
    stores.push(restarted);
    expect(
      restarted.db
        .prepare("SELECT value FROM metadata WHERE key='crash-fixture'")
        .get()
    ).toEqual({ value: "retained" });
    expect(() => new ControlStore(path, KEY)).toThrowError(
      expect.objectContaining({ code: "control_store_owned" })
    );
  });

  it.each([
    [
      "production",
      { hostname: hostname(), pid: 2_147_483_647, runtime: "development" },
    ],
    [
      "development",
      { hostname: "another-host", pid: 2_147_483_647, runtime: "development" },
    ],
    ["development", { pid: 2_147_483_647 }],
    [
      "development",
      { hostname: hostname(), pid: process.pid, runtime: "development" },
    ],
    ["development", { hostname: hostname(), pid: -1, runtime: "development" }],
  ])("preserves live or ambiguous owners in %s", (runtime, metadata) => {
    vi.stubEnv("NODE_ENV", runtime);
    const path = createPath();
    mkdirSync(`${path}.owner`);
    writeFileSync(`${path}.owner/owner.json`, JSON.stringify(metadata));
    expect(() => new ControlStore(path, KEY)).toThrowError(
      expect.objectContaining({ code: "control_store_owned" })
    );
  });

  it("reopens after a clean restart with the same key", () => {
    const path = createPath();
    const first = new ControlStore(path, KEY);
    first.db
      .prepare("INSERT INTO metadata(key,value) VALUES('fixture','retained')")
      .run();
    first.close();

    const restarted = new ControlStore(path, KEY);
    stores.push(restarted);

    expect(
      restarted.db
        .prepare("SELECT value FROM metadata WHERE key='fixture'")
        .get()
    ).toEqual({ value: "retained" });
  });

  it("rejects a restart with the wrong encryption key", () => {
    const path = createPath();
    const first = new ControlStore(path, KEY);
    first.close();

    expect(() => new ControlStore(path, OTHER_KEY)).toThrowError(
      expect.objectContaining({ code: "vault_unavailable" })
    );
    const restarted = new ControlStore(path, KEY);
    stores.push(restarted);
  });
});
