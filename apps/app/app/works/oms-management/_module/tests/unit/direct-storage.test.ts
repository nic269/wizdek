import { Readable } from "node:stream";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseFingerprint } from "../../server/oms-api/client";
import type { Connection } from "../../server/profiles/schema";
import {
  type DirectStorage,
  directResources,
} from "../../server/services/direct-config";
import {
  boundedObjectBody,
  MAX_FILE_BYTES,
  objectLocation,
} from "../../server/services/direct-storage";
import { workflowImportFile } from "../../server/services/workflow-import-file";

const connection: Connection = {
  accountIds: ["account"],
  api: null,
  database: {
    host: "db.example.com",
    name: "stage",
    password: "p",
    port: 5432,
    tls: true,
    user: "u",
  },
  globalDiagnostics: false,
};
const storage: DirectStorage = {
  bucket: "oms",
  forcePathStyle: false,
  prefix: "staging",
  region: "ap-southeast-1",
};
afterEach(() => vi.unstubAllEnvs());
describe("direct storage isolation", () => {
  it("resolves resource secrets only for the selected DB fingerprint", () => {
    vi.stubEnv(
      "OMS_DIRECT_RESOURCES_JSON",
      JSON.stringify({
        [databaseFingerprint(connection)]: {
          encryptionKey: "private",
          storage,
        },
      })
    );
    expect(directResources(connection).storage?.bucket).toBe("oms");
    expect(
      directResources({
        ...connection,
        database: { ...connection.database, name: "production" },
      })
    ).toEqual({});
  });
  it("returns no raw secret configuration in parse failures", () => {
    vi.stubEnv("OMS_DIRECT_RESOURCES_JSON", "secret-invalid-json");
    expect(() => directResources(connection)).toThrow(
      "OMS direct resource configuration is invalid."
    );
  });
  it("limits S3 objects to the configured bucket and prefix boundary", () => {
    expect(
      objectLocation("s3://oms/staging/import-uploads/a.csv", storage)
    ).toEqual({ Bucket: "oms", Key: "staging/import-uploads/a.csv" });
    for (const uri of [
      "https://evil/a",
      "s3://prod/staging/a",
      "s3://oms/staging-other/a",
      "s3://oms/staging/../production/a",
    ]) {
      expect(() => objectLocation(uri, storage)).toThrow(
        expect.objectContaining({ code: "storage_scope_denied" })
      );
    }
  });
  it("preserves exact bytes and rejects large announced and streamed bodies", async () => {
    expect(
      await boundedObjectBody(
        Readable.from([Buffer.from([0, 255]), Buffer.from([10])]),
        3
      )
    ).toEqual(Buffer.from([0, 255, 10]));
    const announced = Readable.from([]);
    await expect(
      boundedObjectBody(announced, MAX_FILE_BYTES + 1)
    ).rejects.toMatchObject({ code: "file_size_limit" });
    expect(announced.destroyed).toBe(true);
    await expect(
      boundedObjectBody(
        Readable.from([Buffer.alloc(MAX_FILE_BYTES), Buffer.from([1])])
      )
    ).rejects.toMatchObject({ code: "file_size_limit" });
  });
});
describe("direct file DB paths without API", () => {
  it("preserves legacy DB_TEXT bytes without calling an OMS API", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ accountId: "account", id: "run" }] })
      .mockResolvedValueOnce({ rows: [{ batch: true, upload: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            contentBytes: 4,
            id: "batch",
            mimeType: "application/pdf",
            originalName: "x.pdf",
            storageType: "DB_TEXT",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ contentText: "AP8K" }] });
    const result = await workflowImportFile(
      { query } as unknown as PoolClient,
      connection,
      "run"
    );
    expect(result.content).toEqual(Buffer.from([0, 255, 10]));
    expect(result.disposition).toContain("x.pdf");
  });
  it("fails cleanly on unavailable metadata instead of falling back to the API", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ accountId: "account", id: "run" }] })
      .mockResolvedValueOnce({ rows: [{ batch: false, upload: false }] });
    await expect(
      workflowImportFile({ query } as unknown as PoolClient, connection, "run")
    ).rejects.toMatchObject({ code: "import_storage_unavailable" });
  });
});
