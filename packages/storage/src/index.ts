export * from "./keys";
export * from "./provider";
export * from "./providers/local";
export * from "./providers/memory";
export * from "./providers/s3";

import { keys } from "./keys";
import { createLocalStorageProvider } from "./providers/local";
import { createMemoryStorageProvider } from "./providers/memory";
import { createS3StorageProvider, isS3StorageConfigured } from "./providers/s3";

export interface StorageProviderStatus {
  configured: boolean;
  message?: string;
  mode: "durable" | "ephemeral" | "local" | "disabled";
  provider: "local" | "memory" | "s3" | "r2";
  state: "configured" | "disabled" | "misconfigured";
}

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export const getStorageProviderStatus = (): StorageProviderStatus => {
  const env = keys();
  const provider = env.STORAGE_PROVIDER ?? "local";

  if (provider === "memory") {
    return {
      configured: true,
      mode: "ephemeral",
      provider,
      state: "configured",
    };
  }

  if (provider === "s3" || provider === "r2") {
    const configured = isS3StorageConfigured({
      accessKeyId: env.S3_ACCESS_KEY_ID,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });

    if (!configured) {
      const missing = [
        ...(env.S3_BUCKET ? [] : ["S3_BUCKET"]),
        ...(env.S3_REGION ? [] : ["S3_REGION"]),
        ...(env.S3_ACCESS_KEY_ID ? [] : ["S3_ACCESS_KEY_ID"]),
        ...(env.S3_SECRET_ACCESS_KEY ? [] : ["S3_SECRET_ACCESS_KEY"]),
      ];
      return {
        configured: false,
        message: `${provider} storage configuration is missing: ${missing.join(", ")}.`,
        mode: "durable",
        provider,
        state: "misconfigured",
      };
    }

    return { configured: true, mode: "durable", provider, state: "configured" };
  }

  return {
    configured: true,
    mode: "local",
    provider: "local",
    state: "configured",
  };
};

export const assertStorageProviderConfiguration = () => {
  const status = getStorageProviderStatus();
  if (
    process.env.NODE_ENV === "production" &&
    status.state === "misconfigured"
  ) {
    throw new StorageConfigurationError(
      status.message ?? "Storage provider configuration is incomplete."
    );
  }
  return status;
};

export const getStorageProvider = () => {
  const env = keys();
  const status = assertStorageProviderConfiguration();

  if (env.STORAGE_PROVIDER === "memory") {
    return createMemoryStorageProvider();
  }

  if (status.provider === "s3" || status.provider === "r2") {
    if (
      env.S3_BUCKET &&
      env.S3_REGION &&
      env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY
    ) {
      return createS3StorageProvider({
        accessKeyId: env.S3_ACCESS_KEY_ID,
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
        ...(env.S3_FORCE_PATH_STYLE === undefined
          ? {}
          : { forcePathStyle: env.S3_FORCE_PATH_STYLE }),
      });
    }

    return createLocalStorageProvider(env.LOCAL_STORAGE_DIR);
  }

  return createLocalStorageProvider(env.LOCAL_STORAGE_DIR);
};
