import { Pool, type PoolClient, type PoolConfig, types } from "pg";
import type { Config } from "../config";
import { invariant } from "../errors";
import { validateNetwork } from "../profiles/network-policy";
import type { Connection } from "../profiles/schema";

export const omsPgTypes: PoolConfig["types"] = {
  getTypeParser: (oid, format) =>
    oid === 1114 && format !== "binary"
      ? (value: string) => types.getTypeParser(1184)(`${value}Z`)
      : types.getTypeParser(oid, format),
};

interface Entry {
  leases: number;
  pool: Pool;
  touched: number;
}
export class ClientRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly limit: number;
  private readonly opening = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(limit: number) {
    this.limit = limit;
  }
  async lease(
    key: string,
    connection: Connection,
    config: Config,
    recovery = false
  ): Promise<{ client: PoolClient; release: () => void }> {
    const pending = this.pending.get(key);
    if (pending) {
      await pending;
      return this.lease(key, connection, config, recovery);
    }
    let entry = this.entries.get(key);
    if (!entry) {
      // Reserve one slot for recovery; count pending opens to bound concurrent first requests.
      const cap = this.limit + (recovery ? 1 : 0);
      invariant(
        !this.opening.has(key),
        "pool_opening",
        "This connection is being initialized. Try again shortly.",
        503
      );
      this.opening.add(key);
      let completeOpening!: () => void;
      this.pending.set(
        key,
        new Promise<void>((resolve) => {
          completeOpening = resolve;
        })
      );
      try {
        if (this.entries.size + this.opening.size > cap) {
          const [idle] = [...this.entries]
            .filter(([, v]) => v.leases === 0)
            .sort((a, b) => a[1].touched - b[1].touched);
          invariant(
            idle,
            "pool_capacity",
            "All database connections are busy. Try again shortly.",
            503
          );
          this.entries.delete(idle[0]);
          await idle[1].pool.end();
        }
        const pinned = await validateNetwork(
          { ...connection, api: null },
          config
        );
        const db = connection.database;
        const pool = new Pool({
          application_name: "oms-management",
          connectionTimeoutMillis: 5000,
          database: db.name,
          host: pinned.db.address,
          idleTimeoutMillis: 30_000,
          max: 3,
          options: "-c timezone=UTC",
          password: db.password,
          port: db.port,
          query_timeout: 10_000,
          ssl: db.tls
            ? {
                rejectUnauthorized: db.verifyTls !== false,
                servername: db.host,
              }
            : false,
          statement_timeout: 8000,
          // Prisma stores these timestamps as UTC without a SQL timezone.
          // Keep parsing local to OMS pools; node-pg otherwise uses the host TZ.
          types: omsPgTypes,
          user: db.user,
        });
        pool.on("error", () => {
          /* Pool errors are surfaced on the next query without credential logging. */
        });
        entry = { leases: 0, pool, touched: Date.now() };
        this.entries.set(key, entry);
      } finally {
        this.opening.delete(key);
        this.pending.delete(key);
        completeOpening();
      }
    }
    entry.leases += 1;
    entry.touched = Date.now();
    let client: PoolClient;
    try {
      client = await entry.pool.connect();
    } catch (error) {
      entry.leases -= 1;
      throw error;
    }
    let released = false;
    return {
      client,
      release: () => {
        if (!released) {
          released = true;
          client.release();
          entry.leases -= 1;
          entry.touched = Date.now();
        }
      },
    };
  }
  async close() {
    invariant(
      [...this.entries.values()].every((e) => e.leases === 0),
      "active_leases",
      "Connections are still in use.",
      409
    );
    await Promise.all([...this.entries.values()].map((e) => e.pool.end()));
    this.entries.clear();
  }
}
const state = globalThis as typeof globalThis & { omsClients?: ClientRegistry };
export const clients = (config: Config) => {
  state.omsClients ??= new ClientRegistry(config.poolLimit);
  return state.omsClients;
};
