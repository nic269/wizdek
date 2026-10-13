import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStorageProviderConfiguration,
  getStorageProvider,
  getStorageProviderStatus,
  StorageConfigurationError,
} from ".";
import { buildTenantObjectKey, sanitizeObjectKeySegment } from "./provider";
import { isS3StorageConfigured } from "./providers/s3";

const ORGANIZATION_OBJECT_KEY_PATTERN = /^org\/org\/[a-f0-9-]+-debug.csv$/;

describe("storage provider", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("sanitizes tenant object keys", () => {
    expect(sanitizeObjectKeySegment("../invoice final.pdf")).toBe(
      "invoice-final.pdf"
    );
    expect(
      buildTenantObjectKey({
        fileName: "../../debug.csv",
        organizationId: "../org",
      })
    ).toMatch(ORGANIZATION_OBJECT_KEY_PATTERN);
  });

  it("uses local storage by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "wizloft-storage-"));
    vi.stubEnv("LOCAL_STORAGE_DIR", root);
    expect(getStorageProviderStatus()).toEqual({
      configured: true,
      mode: "local",
      provider: "local",
      state: "configured",
    });
    const provider = getStorageProvider();

    await provider.putObject({
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
      key: "org/acme/file.txt",
    });

    await expect(
      readFile(join(root, "org/acme/file.txt"), "utf8")
    ).resolves.toBe("hello");
    await expect(
      provider.getObject({ key: "org/acme/file.txt" })
    ).resolves.toMatchObject({
      key: "org/acme/file.txt",
      provider: "local",
    });
  });

  it("reports missing s3 credentials without throwing and falls back locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "wizloft-storage-"));
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("LOCAL_STORAGE_DIR", root);
    vi.stubEnv("S3_BUCKET", "private-files");

    expect(getStorageProviderStatus()).toEqual({
      configured: false,
      message:
        "s3 storage configuration is missing: S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.",
      mode: "durable",
      provider: "s3",
      state: "misconfigured",
    });
    await expect(
      getStorageProvider().putObject({
        body: new TextEncoder().encode("fallback"),
        contentType: "text/plain",
        key: "global/test.txt",
      })
    ).resolves.toMatchObject({ provider: "local" });
  });

  it("fails fast on partial s3 configuration in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("S3_BUCKET", "private-files");

    expect(() => assertStorageProviderConfiguration()).toThrow(
      StorageConfigurationError
    );
  });

  it("detects complete s3 configuration", () => {
    expect(
      isS3StorageConfigured({
        accessKeyId: "key",
        bucket: "bucket",
        region: "auto",
        secretAccessKey: "secret",
      })
    ).toBe(true);
  });
});
