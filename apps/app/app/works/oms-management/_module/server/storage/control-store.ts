import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Config } from "../config";
import { invariant, ManagementError } from "../errors";
import { Vault } from "../profiles/crypto";

// Only local development can reclaim a confirmed dead process. Production,
// legacy metadata and ambiguous owners retain the operator recovery procedure.
function acquireOwnerLock(lock: string): boolean {
  try {
    mkdirSync(lock, { mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  if (process.env.NODE_ENV !== "development") {
    return false;
  }
  const recovery = `${lock}.recovery`;
  try {
    mkdirSync(recovery, { mode: 0o700 });
  } catch {
    return false;
  }
  try {
    // Re-read under the recovery mutex: another contender may have recovered
    // the store since our initial mkdir failed.
    const owner = JSON.parse(readFileSync(`${lock}/owner.json`, "utf8"));
    if (
      owner.hostname !== hostname() ||
      owner.runtime !== "development" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0
    ) {
      return false;
    }
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        return false;
      }
    }
    rmSync(lock, { recursive: true });
    // An ordinary starter can win this mkdir; in that case it owns the store.
    mkdirSync(lock, { mode: 0o700 });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(recovery, { recursive: true });
  }
}

export class ControlStore {
  readonly db: DatabaseSync;
  readonly vault: Vault;
  private readonly lock: string;
  private readonly owner = randomUUID();
  constructor(path: string, key: string) {
    this.vault = new Vault(key);
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { mode: 0o700, recursive: true });
    this.lock = `${absolute}.owner`;
    if (!acquireOwnerLock(this.lock)) {
      throw new ManagementError(
        "control_store_owned",
        "Another instance owns the control store. Follow the recovery runbook.",
        503
      );
    }
    try {
      writeFileSync(
        `${this.lock}/owner.json`,
        JSON.stringify({
          hostname: hostname(),
          owner: this.owner,
          pid: process.pid,
          runtime: process.env.NODE_ENV,
          startedAt: new Date().toISOString(),
        }),
        { mode: 0o600 }
      );
      this.db = new DatabaseSync(absolute);
      chmodSync(absolute, 0o600);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL,
          safety_class TEXT NOT NULL, preset TEXT, enabled INTEGER NOT NULL DEFAULT 1,
          source_hash TEXT, override INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS revisions (
          profile_id TEXT NOT NULL REFERENCES profiles(id), revision INTEGER NOT NULL,
          ciphertext TEXT NOT NULL, validated INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, PRIMARY KEY(profile_id, revision)
        );
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, profile_id TEXT NOT NULL,
          revision INTEGER NOT NULL, action TEXT NOT NULL, payload_hash TEXT NOT NULL,
          state TEXT NOT NULL, request_cipher TEXT NOT NULL, result_cipher TEXT,
          confirmation_hash TEXT, expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(profile_id, revision) REFERENCES revisions(profile_id, revision)
        );
        CREATE TABLE IF NOT EXISTS audit (
          id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, profile_id TEXT, revision INTEGER,
          action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS backup_evidence (
          operation_id TEXT PRIMARY KEY REFERENCES operations(id),
          target_fingerprint TEXT NOT NULL, backup_reference TEXT NOT NULL,
          checksum TEXT NOT NULL, ciphertext TEXT NOT NULL,
          created_at TEXT NOT NULL, verified_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS operations_target ON operations(profile_id, revision, state);
      `);
      const check = this.db
        .prepare("SELECT value FROM metadata WHERE key='key_check'")
        .get() as { value: string } | undefined;
      if (check) {
        invariant(
          this.vault.open(check.value, "key-check") === "oms-management",
          "vault_unavailable",
          "The profile vault cannot be unlocked.",
          503
        );
      } else {
        this.db
          .prepare("INSERT INTO metadata(key,value) VALUES('key_check',?)")
          .run(this.vault.seal("oms-management", "key-check"));
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(
    actorId: string,
    profileId: string | null,
    revision: number | null,
    action: string,
    detail: unknown
  ) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        actorId,
        profileId,
        revision,
        action,
        JSON.stringify(detail),
        new Date().toISOString()
      );
  }
  close() {
    this.db?.close();
    try {
      const owner = JSON.parse(readFileSync(`${this.lock}/owner.json`, "utf8"));
      if (owner.owner === this.owner) {
        rmSync(this.lock, { recursive: true });
      }
    } catch {
      /* Never delete a different owner's lock. */
    }
  }
}
const state = globalThis as typeof globalThis & {
  omsControlStore?: ControlStore;
};
export function controlStore(config: Config) {
  if (!state.omsControlStore) {
    state.omsControlStore = new ControlStore(
      config.controlPath,
      config.encryptionKey
    );
    process.once("exit", () => state.omsControlStore?.close());
  }
  return state.omsControlStore;
}
