import { z } from "zod";
import { capabilitySchema } from "../lib/contracts";
import { ManagementError } from "./errors";

const policySchema = z.array(
  z.object({
    capabilities: z.array(capabilitySchema),
    profiles: z.array(z.string()).min(1),
    userId: z.string().min(1),
  })
);
const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
export function getConfig() {
  const { env } = process;
  try {
    const publicOrigin = new URL(
      env.OMS_PUBLIC_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000"
    ).origin;
    const identityOrigin = new URL(
      env.WIZDEK_IDENTITY_ORIGIN ?? "http://localhost:4002"
    ).origin;
    if (env.NODE_ENV === "production" && !publicOrigin.startsWith("https://")) {
      throw new Error("Production public origin must use HTTPS.");
    }
    return {
      allowedUsers: new Set(list(env.OMS_ALLOWED_WIZDEK_USER_IDS)),
      allowLoopback:
        env.NODE_ENV !== "production" &&
        env.OMS_ALLOW_LOCAL_CONNECTIONS === "true",
      apiOrigins: new Set(list(env.OMS_ALLOWED_API_ORIGINS)),
      backupEvidence: z
        .record(
          z.string(),
          z.object({
            backupReference: z.string().min(1).max(500),
            databaseFingerprint: z.string().length(64),
            databaseIdentity: z.string().uuid(),
            expiresAt: z.string().datetime(),
            restoreVerifiedAt: z.string().datetime(),
          })
        )
        .parse(JSON.parse(env.OMS_BACKUP_EVIDENCE_JSON ?? "{}")),
      controlPath:
        env.OMS_CONTROL_DB_PATH ?? ".data/oms-management/control.sqlite",
      dbHosts: new Set(list(env.OMS_ALLOWED_DB_HOSTS)),
      dbPorts: new Set(list(env.OMS_ALLOWED_DB_PORTS).map(Number)),
      encryptionKey: env.OMS_PROFILE_ENCRYPTION_KEY ?? "",
      identityOrigin,
      policy: policySchema.parse(
        JSON.parse(env.OMS_ACCESS_POLICY_JSON ?? "[]")
      ),
      poolLimit: Math.min(
        10,
        Math.max(1, Number(env.OMS_POOL_LIMIT ?? 4) || 4)
      ),
      profileScopes: z
        .record(
          z.string(),
          z.object({
            accountIds: z.array(z.string()),
            globalDiagnostics: z.boolean(),
          })
        )
        .parse(JSON.parse(env.OMS_PROFILE_SCOPES_JSON ?? "{}")),
      publicOrigin,
      targetBindings: z
        .array(
          z.object({
            apiOrigin: z.string().url(),
            database: z.string(),
            databaseIdentity: z.string().uuid(),
            deploymentId: z.string(),
            host: z.string(),
            port: z.number().int(),
            safetyClass: z.enum(["staging", "production"]),
          })
        )
        .parse(JSON.parse(env.OMS_TARGET_BINDINGS_JSON ?? "[]")),
    };
  } catch {
    throw new ManagementError(
      "configuration_invalid",
      "Management configuration is invalid.",
      503
    );
  }
}
export type Config = ReturnType<typeof getConfig>;
