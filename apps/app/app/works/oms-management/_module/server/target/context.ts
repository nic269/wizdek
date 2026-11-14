import type { PoolClient } from "pg";
import type { Actor, TargetRef } from "../../lib/contracts";
import type { Config } from "../config";
import { invariant } from "../errors";
import { Profiles } from "../profiles/repository";
import type { Connection } from "../profiles/schema";
import { controlStore } from "../storage/control-store";
import { clients } from "./clients";
import { probe } from "./compatibility";
export function profiles(config: Config) {
  const repository = new Profiles(controlStore(config), config);
  repository.seedPresets();
  return repository;
}
export async function readTarget<T>(
  actor: Actor,
  ref: TargetRef,
  config: Config,
  feature: string,
  fn: (db: PoolClient, connection: Connection) => Promise<T>
) {
  const repository = profiles(config);
  const resolved = repository.acquire(actor, ref);
  const lease = await clients(config)
    .lease(`${ref.profileId}:${ref.revision}`, resolved.connection, config)
    .catch((error) => {
      resolved.release();
      throw error;
    });
  try {
    await lease.client.query("BEGIN READ ONLY");
    const compatibility = await probe(lease.client);
    invariant(
      resolved.row.safety_class === "production" ||
        !config.targetBindings.some(
          (item) =>
            item.safetyClass === "production" &&
            item.databaseIdentity === compatibility.databaseIdentity
        ),
      "safety_mismatch",
      "This connection identifies a production database. Update its profile classification.",
      409
    );
    invariant(
      feature === "health" || compatibility.features.includes(feature),
      "feature_unavailable",
      "This database does not support this feature with the configured grants.",
      409
    );
    const result = await fn(lease.client, resolved.connection);
    await lease.client.query("COMMIT");
    return result;
  } catch (error) {
    await lease.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    lease.release();
    resolved.release();
  }
}
