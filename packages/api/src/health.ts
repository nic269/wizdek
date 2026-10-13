import { authMailRequired, featureConfig } from "@repo/config";
import { prisma } from "@repo/database";
import { getJobProviderStatus } from "@repo/jobs";
import {
  assertMailProviderConfiguration,
  getMailProviderStatus,
} from "@repo/mail";
import {
  assertStorageProviderConfiguration,
  getStorageProviderStatus,
} from "@repo/storage";

export const getStatusPayload = () =>
  ({ ok: true, service: "api", time: new Date().toISOString() }) as const;

export const getHealthPayload = () => ({ ok: true }) as const;

export const assertApiProviderConfiguration = () => {
  const providers = getApiProviderReadiness();
  assertMailProviderConfiguration({ required: authMailRequired });
  assertStorageProviderConfiguration();
  const unhealthy = Object.entries(providers)
    .filter(([, provider]) => !provider.healthy)
    .map(([name]) => name);
  if (process.env.NODE_ENV === "production" && unhealthy.length > 0) {
    throw new Error(
      `Required providers are not ready: ${unhealthy.join(", ")}.`
    );
  }
};

interface ProviderStatus {
  configured: boolean;
  state: "configured" | "disabled" | "misconfigured";
}

const withRequirement = <TStatus extends ProviderStatus>(
  status: TStatus,
  required: boolean
) => ({
  ...status,
  healthy:
    status.state === "configured" || (status.state === "disabled" && !required),
  required,
});

export const getApiProviderReadiness = () => {
  const production = process.env.NODE_ENV === "production";
  return {
    jobs: withRequirement(getJobProviderStatus(), featureConfig.jobs),
    mail: withRequirement(
      getMailProviderStatus(),
      production && authMailRequired
    ),
    storage: withRequirement(getStorageProviderStatus(), featureConfig.storage),
  };
};

const checkDatabase = async () => {
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      healthy: true,
      latencyMs: Math.round(performance.now() - startedAt),
    } as const;
  } catch {
    return {
      healthy: false,
      latencyMs: Math.round(performance.now() - startedAt),
      message: "Database connectivity check failed.",
    } as const;
  }
};

export const getReadyPayload = async () => {
  const database = await checkDatabase();
  const providers = getApiProviderReadiness();
  const providersHealthy = Object.values(providers).every(
    (provider) => provider.healthy
  );

  return {
    checks: { database },
    ok: database.healthy && providersHealthy,
    providers,
  } as const;
};
