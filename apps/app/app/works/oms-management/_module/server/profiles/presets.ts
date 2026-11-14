import { invariant } from "../errors";
import { connectionSchema } from "./schema";
export function readPreset(
  id: "staging" | "production",
  env: NodeJS.ProcessEnv = process.env
) {
  const prefix = `OMS_${id.toUpperCase()}`;
  const raw = env[`${prefix}_DATABASE_URL`];
  if (!raw) {
    return null;
  }
  const url = new URL(raw);
  invariant(
    ["postgres:", "postgresql:"].includes(url.protocol),
    "preset_invalid",
    "Preset database protocol is invalid.",
    503
  );
  const apiOrigin = env[`${prefix}_API_URL`];
  return connectionSchema.parse({
    accountIds: (env[`${prefix}_ACCOUNT_IDS`] ?? "").split(",").filter(Boolean),
    api: apiOrigin
      ? {
          databaseIdentity: env[`${prefix}_DATABASE_ID`],
          deploymentId: env[`${prefix}_DEPLOYMENT_ID`],
          origin: apiOrigin,
          token: env[`${prefix}_SERVICE_TOKEN`],
        }
      : null,
    database: {
      host: url.hostname,
      name: decodeURIComponent(url.pathname.slice(1)),
      password: decodeURIComponent(url.password),
      port: Number(url.port || 5432),
      tls: url.searchParams.get("sslmode") !== "disable",
      user: decodeURIComponent(url.username),
    },
    globalDiagnostics: env[`${prefix}_GLOBAL_DIAGNOSTICS`] === "true",
  });
}
