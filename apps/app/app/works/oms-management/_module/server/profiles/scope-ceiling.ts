import type { SafetyClass } from "../../lib/contracts";
import type { Config } from "../config";
import { invariant } from "../errors";
import type { Connection } from "./schema";
export function assertProfileScope(
  connection: Connection,
  id: string,
  safetyClass: SafetyClass,
  config: Config
) {
  const selected =
    config.profileScopes[id] ?? config.profileScopes[safetyClass];
  const ceilings =
    safetyClass === "production"
      ? [selected, config.profileScopes.production]
      : [selected];
  invariant(
    ceilings.every(
      (ceiling) =>
        ceiling &&
        connection.accountIds.every((account) =>
          ceiling.accountIds.includes(account)
        ) &&
        (!connection.globalDiagnostics || ceiling.globalDiagnostics)
    ),
    "scope_denied",
    "This connection exceeds the server-configured account/global scope.",
    403
  );
}
