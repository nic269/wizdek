import type { Actor, Capability, PublicProfile } from "../../lib/contracts";
import type { Config } from "../config";
import { invariant } from "../errors";
export function capabilitiesFor(
  actor: Actor,
  profile: Pick<PublicProfile, "id" | "safetyClass">,
  config: Config
): Capability[] {
  const granted = new Set<Capability>();
  if (config.allowedUsers.has(actor.id)) {
    granted.add("read");
  }
  for (const rule of config.policy) {
    if (rule.userId !== actor.id) {
      continue;
    }
    if (
      profile.safetyClass === "production" &&
      !rule.profiles.some((p) => p === "production" || p === "*")
    ) {
      continue;
    }
    if (
      !rule.profiles.some(
        (p) => p === profile.id || p === profile.safetyClass || p === "*"
      )
    ) {
      continue;
    }
    for (const capability of rule.capabilities) {
      granted.add(capability);
    }
  }
  return [...granted];
}
export function requireCapability(
  actor: Actor,
  profile: Pick<PublicProfile, "id" | "safetyClass">,
  capability: Capability,
  config: Config
) {
  invariant(
    capabilitiesFor(actor, profile, config).includes(capability),
    "forbidden",
    capability === "profiles:edit"
      ? `Your access policy does not allow managing this ${profile.safetyClass} connection. Ask the operator to grant profiles:edit for this connection or environment.`
      : "You do not have permission for this action.",
    403
  );
}
