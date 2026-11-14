import { createHash } from "node:crypto";
import type {
  Actor,
  PublicProfile,
  SafetyClass,
  TargetRef,
} from "../../lib/contracts";
import type { Config } from "../config";
import { invariant } from "../errors";
import { capabilitiesFor, requireCapability } from "../identity/access-policy";
import { verifyBinding } from "../oms-api/client";
import type { ControlStore } from "../storage/control-store";
import { clients } from "../target/clients";
import { type Compatibility, probe } from "../target/compatibility";
import { pinnedAddress } from "./network-policy";
import { readPreset } from "./presets";
import { type Connection, connectionSchema, type ProfileEdit } from "./schema";
import { assertProfileScope } from "./scope-ceiling";

interface Row {
  enabled: number;
  id: string;
  name: string;
  override: number;
  preset: "staging" | "production" | null;
  revision: number;
  safety_class: SafetyClass;
  source_hash: string | null;
  updated_at: string;
}
export interface Revision {
  compatibility: Compatibility | null;
  connection: Connection;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const activeReads = new Map<string, number>();
export class Profiles {
  readonly config: Config;
  readonly store: ControlStore;

  constructor(store: ControlStore, config: Config) {
    this.config = config;
    this.store = store;
  }
  row(id: string) {
    return this.store.db
      .prepare("SELECT * FROM profiles WHERE id=?")
      .get(id) as unknown as Row | undefined;
  }
  revision(ref: TargetRef): Revision {
    const row = this.store.db
      .prepare(
        "SELECT ciphertext FROM revisions WHERE profile_id=? AND revision=?"
      )
      .get(ref.profileId, ref.revision) as { ciphertext: string } | undefined;
    invariant(
      row,
      "profile_not_found",
      "Connection revision was not found.",
      404
    );
    return this.store.vault.open(
      row.ciphertext,
      `profile:${ref.profileId}:${ref.revision}`
    );
  }
  resolve(
    actor: Actor,
    ref: TargetRef,
    capability:
      | "read"
      | "settings:write"
      | "commands"
      | "secrets:reveal" = "read"
  ) {
    const row = this.row(ref.profileId);
    invariant(
      row?.enabled,
      "profile_unavailable",
      "Connection is not available.",
      404
    );
    requireCapability(
      actor,
      { id: row.id, safetyClass: row.safety_class },
      capability,
      this.config
    );
    invariant(
      row.revision === ref.revision,
      "revision_conflict",
      "The connection changed. Reload before continuing.",
      409
    );
    const revision = this.revision(ref);
    assertProfileScope(
      revision.connection,
      row.id,
      row.safety_class,
      this.config
    );
    return { row, ...revision };
  }
  acquire(actor: Actor, ref: TargetRef) {
    const resolved = this.resolve(actor, ref);
    const key = `${this.config.controlPath}:${ref.profileId}`;
    activeReads.set(key, (activeReads.get(key) ?? 0) + 1);
    let released = false;
    return {
      ...resolved,
      release: () => {
        if (!released) {
          released = true;
          const remaining = (activeReads.get(key) ?? 1) - 1;
          if (remaining) {
            activeReads.set(key, remaining);
          } else {
            activeReads.delete(key);
          }
        }
      },
    };
  }
  assertNoReaders(id: string) {
    invariant(
      !activeReads.get(`${this.config.controlPath}:${id}`),
      "active_readers",
      "Wait for active reads to finish before changing this connection.",
      409
    );
  }
  public(row: Row, actor: Actor): PublicProfile {
    const revision = this.revision({
      profileId: row.id,
      revision: row.revision,
    });
    return {
      capabilities: capabilitiesFor(
        actor,
        { id: row.id, safetyClass: row.safety_class },
        this.config
      ),
      databaseLabel:
        revision.connection.database.host +
        "/" +
        revision.connection.database.name,
      enabled: !!row.enabled,
      hasApi: !!revision.connection.api,
      id: row.id,
      name: row.name,
      preset: row.preset,
      revision: row.revision,
      safetyClass: row.safety_class,
      updatedAt: row.updated_at,
      writable: process.env.OMS_WRITES_ENABLED === "true",
    };
  }
  list(actor: Actor) {
    return (
      this.store.db
        .prepare("SELECT * FROM profiles ORDER BY preset IS NULL,name")
        .all() as unknown as Row[]
    )
      .map((row) => this.public(row, actor))
      .filter((row) => row.capabilities.includes("read"));
  }
  hasPending(id: string) {
    return !!this.store.db
      .prepare(
        "SELECT id FROM operations WHERE profile_id=? AND state IN ('accepted','running','unknown') LIMIT 1"
      )
      .get(id);
  }
  connectionFor(edit: ProfileEdit): Connection {
    const prior = this.row(edit.id);
    const old = prior
      ? this.revision({ profileId: edit.id, revision: prior.revision })
          .connection
      : null;
    invariant(
      edit.api?.token.mode !== "keep" ||
        (old?.api &&
          new URL(edit.api.origin).origin === new URL(old.api.origin).origin),
      "api_token_required",
      "Enter a service token when changing the API URL.",
      400
    );
    const secret = (
      change: ProfileEdit["database"]["password"],
      previous: string | undefined
    ) => {
      if (change.mode === "replace") {
        return change.value;
      }
      if (change.mode === "clear") {
        return "";
      }
      return previous ?? "";
    };
    return connectionSchema.parse({
      accountIds: edit.accountIds,
      api: edit.api
        ? { ...edit.api, token: secret(edit.api.token, old?.api?.token) }
        : null,
      database: {
        ...edit.database,
        password: secret(edit.database.password, old?.database.password),
      },
      globalDiagnostics: edit.globalDiagnostics,
    });
  }
  safety(
    id: string,
    connection: Connection,
    environment?: SafetyClass
  ): SafetyClass {
    if (
      id === "production" ||
      environment === "production" ||
      this.row(id)?.safety_class === "production"
    ) {
      return "production";
    }
    const anchor = this.config.targetBindings.find(
      (item) =>
        item.host === connection.database.host &&
        item.port === connection.database.port &&
        item.database === connection.database.name
    );
    if (anchor?.safetyClass === "production") {
      return "production";
    }
    const prod = this.row("production");
    if (prod) {
      const c = this.revision({
        profileId: prod.id,
        revision: prod.revision,
      }).connection;
      if (
        (connection.database.host === c.database.host &&
          connection.database.port === c.database.port &&
          connection.database.name === c.database.name) ||
        (connection.api && c.api && connection.api.origin === c.api.origin)
      ) {
        return "production";
      }
    }
    return environment ?? (id === "staging" ? "staging" : "custom");
  }
  async save(actor: Actor, edit: ProfileEdit) {
    const connection = this.connectionFor(edit);
    let safetyClass = this.safety(edit.id, connection, edit.environment);
    const existing = this.row(edit.id);
    if (existing) {
      requireCapability(
        actor,
        { id: existing.id, safetyClass: existing.safety_class },
        "profiles:edit",
        this.config
      );
    }
    requireCapability(
      actor,
      { id: edit.id, safetyClass },
      "profiles:edit",
      this.config
    );
    assertProfileScope(connection, edit.id, safetyClass, this.config);
    const address = await pinnedAddress(
      connection.database.host,
      this.config.allowLoopback
    );
    for (const anchor of this.config.targetBindings.filter(
      (item) =>
        item.safetyClass === "production" &&
        item.port === connection.database.port &&
        item.database === connection.database.name
    )) {
      const productionAddress = await pinnedAddress(
        anchor.host,
        this.config.allowLoopback
      );
      if (address.address === productionAddress.address) {
        safetyClass = "production";
      }
    }
    invariant(
      !this.hasPending(edit.id),
      "operations_pending",
      "Resolve pending operations before changing this connection.",
      409
    );
    const key = `test:${digest(connection)}`;
    const lease = await clients(this.config).lease(
      key,
      connection,
      this.config
    );
    let compatibility: Compatibility;
    try {
      await lease.client.query("BEGIN READ ONLY");
      compatibility = await probe(lease.client);
    } finally {
      await lease.client.query("ROLLBACK").catch(() => undefined);
      lease.release();
    }
    if (connection.api) {
      const identity = await verifyBinding(
        connection,
        this.config,
        compatibility.databaseIdentity
      );
      // Older deployed bridges still need their discovered metadata on requests.
      // Operators only supply the URL and token; these values never need manual entry.
      connection.api = {
        origin: connection.api.origin,
        token: connection.api.token,
        ...(typeof identity.databaseIdentity === "string"
          ? { databaseIdentity: identity.databaseIdentity }
          : {}),
        ...(identity.version !== 2 && typeof identity.deploymentId === "string"
          ? { deploymentId: identity.deploymentId }
          : {}),
      };
    }
    if (
      this.config.targetBindings.some(
        (item) =>
          item.safetyClass === "production" &&
          item.databaseIdentity === compatibility.databaseIdentity
      )
    ) {
      safetyClass = "production";
    }
    requireCapability(
      actor,
      { id: edit.id, safetyClass },
      "profiles:edit",
      this.config
    );
    assertProfileScope(connection, edit.id, safetyClass, this.config);
    return this.store.transaction(() => {
      const current = this.row(edit.id);
      invariant(
        (current?.revision ?? 0) === edit.expectedRevision,
        "revision_conflict",
        "Another operator changed this connection.",
        409
      );
      invariant(
        !this.hasPending(edit.id),
        "operations_pending",
        "Resolve pending operations before changing this connection.",
        409
      );
      this.assertNoReaders(edit.id);
      const revision = edit.expectedRevision + 1;
      const now = new Date().toISOString();
      this.store.db
        .prepare(`INSERT INTO profiles(id,revision,name,safety_class,preset,enabled,override,updated_at) VALUES(?,?,?,?,?,1,1,?)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name,safety_class=excluded.safety_class,enabled=1,override=1,updated_at=excluded.updated_at`)
        .run(
          edit.id,
          revision,
          edit.name,
          safetyClass,
          current?.preset ?? null,
          now
        );
      this.store.db
        .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
        .run(
          edit.id,
          revision,
          this.store.vault.seal(
            { compatibility, connection },
            `profile:${edit.id}:${revision}`
          ),
          1,
          now
        );
      this.store.audit(actor.id, edit.id, revision, "profile.saved", {
        name: edit.name,
        safetyClass,
      });
      const saved = this.row(edit.id);
      invariant(saved, "profile_not_found", "Connection was not found.", 404);
      return this.public(saved, actor);
    });
  }
  disable(actor: Actor, ref: TargetRef) {
    const { row } = this.resolve(actor, ref);
    requireCapability(
      actor,
      { id: row.id, safetyClass: row.safety_class },
      "profiles:edit",
      this.config
    );
    this.store.transaction(() => {
      invariant(
        !this.hasPending(row.id),
        "operations_pending",
        "Resolve pending operations first.",
        409
      );
      this.assertNoReaders(row.id);
      this.store.db
        .prepare("UPDATE profiles SET enabled=0 WHERE id=? AND revision=?")
        .run(row.id, ref.revision);
      this.store.audit(actor.id, row.id, ref.revision, "profile.disabled", {});
    });
  }
  editable(actor: Actor, ref: TargetRef) {
    const { row, connection } = this.resolve(actor, ref);
    requireCapability(
      actor,
      { id: row.id, safetyClass: row.safety_class },
      "profiles:edit",
      this.config
    );
    const { password: _, ...database } = connection.database;
    const api = connection.api
      ? {
          origin: connection.api.origin,
        }
      : null;
    const preset = row.preset ? readPreset(row.preset) : null;
    return {
      accountIds: connection.accountIds,
      api,
      database,
      globalDiagnostics: connection.globalDiagnostics,
      presetChanged: !!preset && digest(preset) !== row.source_hash,
    };
  }
  async reset(actor: Actor, ref: TargetRef) {
    const row = this.row(ref.profileId);
    invariant(
      row?.preset,
      "preset_required",
      "This connection is not a server preset."
    );
    const connection = readPreset(row.preset);
    invariant(
      connection,
      "preset_unavailable",
      "No server configuration exists for this preset.",
      409
    );
    const profile = await this.save(actor, {
      accountIds: connection.accountIds,
      api: connection.api
        ? {
            ...connection.api,
            token: { mode: "replace", value: connection.api.token },
          }
        : null,
      database: {
        ...connection.database,
        password: connection.database.password
          ? { mode: "replace", value: connection.database.password }
          : { mode: "clear" },
      },
      expectedRevision: ref.revision,
      globalDiagnostics: connection.globalDiagnostics,
      id: row.id,
      name: row.name,
    });
    this.store.db
      .prepare(
        "UPDATE profiles SET override=0,source_hash=? WHERE id=? AND revision=?"
      )
      .run(digest(connection), row.id, profile.revision);
    return profile;
  }
  seedPresets(env: NodeJS.ProcessEnv = process.env) {
    for (const id of ["staging", "production"] as const) {
      const connection = readPreset(id, env);
      if (!connection) {
        continue;
      }
      const hash = digest(connection);
      const row = this.row(id);
      // Existing connections never change just because environment variables changed.
      if (row) {
        continue;
      }
      this.store.transaction(() => {
        const now = new Date().toISOString();
        this.store.db
          .prepare("INSERT INTO profiles VALUES(?,?,?,?,?,1,?,0,?)")
          .run(
            id,
            1,
            id === "production" ? "Production" : "Staging",
            id,
            id,
            hash,
            now
          );
        this.store.db
          .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
          .run(
            id,
            1,
            this.store.vault.seal(
              { compatibility: null, connection },
              `profile:${id}:1`
            ),
            0,
            now
          );
      });
    }
  }
}
