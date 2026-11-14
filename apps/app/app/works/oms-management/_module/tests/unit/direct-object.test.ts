import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseFingerprint } from "../../server/oms-api/client";
import type { Connection } from "../../server/profiles/schema";
import { directObject } from "../../server/services/direct-storage";

const sdk = vi.hoisted(() => ({
  config: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  S3Client: class {
    constructor(config: unknown) {
      sdk.config(config);
    }
    send = sdk.send;
    destroy = sdk.destroy;
  },
}));
const connection: Connection = {
  accountIds: [],
  api: null,
  database: {
    host: "stage.test",
    name: "stage",
    password: "test",
    port: 5432,
    tls: true,
    user: "test",
  },
  globalDiagnostics: true,
};
function configure() {
  vi.stubEnv(
    "OMS_DIRECT_RESOURCES_JSON",
    JSON.stringify({
      [databaseFingerprint(connection)]: {
        storage: {
          bucket: "private",
          prefix: "staging",
          region: "ap-southeast-1",
        },
      },
    })
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("direct object reads", () => {
  it("reads from the DB-bound bucket without OMS API and destroys its client", async () => {
    configure();
    sdk.send.mockResolvedValue({
      Body: Readable.from([Buffer.from([0, 255])]),
      ContentLength: 2,
      ContentType: "application/pdf",
    });
    expect(
      await directObject(connection, "s3://private/staging/a.pdf")
    ).toEqual({
      content: Buffer.from([0, 255]),
      contentType: "application/pdf",
    });
    expect(sdk.send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "private",
      Key: "staging/a.pdf",
    });
    expect(sdk.destroy).toHaveBeenCalledOnce();
  });
  it("does not construct a storage client for foreign objects", async () => {
    configure();
    await expect(
      directObject(connection, "s3://private/production/a.pdf")
    ).rejects.toMatchObject({ code: "storage_scope_denied" });
    expect(sdk.config).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });
  it("redacts provider errors and closes failed downloads", async () => {
    configure();
    sdk.send.mockRejectedValue(
      new Error("provider-secret-and-private-location")
    );
    await expect(
      directObject(connection, "s3://private/staging/a.pdf")
    ).rejects.toMatchObject({
      code: "storage_download_failed",
      message: "The original file could not be downloaded from object storage.",
    });
    expect(sdk.destroy).toHaveBeenCalledOnce();
  });
});
