import { type Maintenance, maintenanceSchema } from "../../lib/contracts";
import { invariant } from "../errors";

const FORBIDDEN_PATH_CHARACTERS = /[?#*\\\s]/;
const TRAILING_SLASH = /\/$/;

export function parseMaintenance(input: unknown): Maintenance {
  const settings = maintenanceSchema.parse(input);
  const exceptions = new Set<string>();
  for (const entry of settings.exceptions) {
    const path = entry.trim().replace(TRAILING_SLASH, "") || "/";
    invariant(
      entry.trim().startsWith("/") &&
        !FORBIDDEN_PATH_CHARACTERS.test(path) &&
        !entry.includes("//") &&
        new URL(path, "http://local").pathname === path,
      "invalid_exception",
      "Enter exact page paths beginning with /, without query strings or wildcards."
    );
    exceptions.add(path);
  }
  return { enabled: settings.enabled, exceptions: [...exceptions] };
}
