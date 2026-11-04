import { createHash } from "node:crypto";
import { prisma } from "@repo/database";
import { getStorageProvider, type StorageProvider } from "@repo/storage";
import { FlowItemError, type NodeAsset } from "../registry/define-node";

/**
 * Reads an uploaded file for a run. The asset must belong to the run's
 * organization; anything else is reported as missing.
 */
export const createAssetReader =
  (storage: StorageProvider = getStorageProvider()) =>
  async (organizationId: string, assetId: string): Promise<NodeAsset> => {
    const asset = await prisma.fileAsset.findFirst({
      where: { deletedAt: null, id: assetId, organizationId },
    });
    if (!asset) {
      throw new FlowItemError("The uploaded file could not be found.");
    }
    const object = await storage.getObject({ key: asset.objectKey });
    return {
      body: object.body,
      contentType: asset.contentType,
      fileName: asset.fileName,
    };
  };

const CSV_EXTENSION = /\.csv$/i;

/** Stable identity makes retries overwrite the same file instead of creating duplicates. */
export const writeRunAsset = async (
  input: {
    organizationId: string;
    runId: string;
    nodeId: string;
    asset: NodeAsset;
  },
  storage: StorageProvider = getStorageProvider()
) => {
  const id = createHash("sha256")
    .update(JSON.stringify([input.organizationId, input.runId, input.nodeId]))
    .digest("hex");
  const fileName = `${
    input.asset.fileName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(CSV_EXTENSION, "")
      .slice(0, 160) || "export"
  }.csv`;
  const stored = await storage.putObject({
    ...input.asset,
    key: `organizations/${input.organizationId}/flow-exports/${id}.csv`,
  });
  const data = {
    contentType: input.asset.contentType,
    fileName,
    metadata: {
      nodeId: input.nodeId,
      purpose: "flow-export",
      runId: input.runId,
    },
    objectKey: stored.key,
    organizationId: input.organizationId,
    provider: stored.provider,
    sizeBytes: BigInt(stored.sizeBytes),
  };
  await prisma.fileAsset.upsert({
    create: { id, ...data },
    update: data,
    where: { id },
  });
  return { fileName, id, sizeBytes: stored.sizeBytes };
};

/** Checkpoint blobs are private and scoped to an exact organization/run/node. */
export const createCheckpointStorage = (
  scope: { organizationId: string; runId: string; nodeId: string },
  storage: StorageProvider = getStorageProvider()
) => {
  const keyFor = (key: string) => {
    const id = createHash("sha256")
      .update(
        JSON.stringify([scope.organizationId, scope.runId, scope.nodeId, key])
      )
      .digest("hex");
    return `organizations/${scope.organizationId}/flow-checkpoints/${id}.json`;
  };
  return {
    read: async (key: string): Promise<Record<string, unknown>> => {
      const object = await storage.getObject({ key: keyFor(key) });
      return JSON.parse(new TextDecoder().decode(object.body));
    },
    write: async (
      key: string,
      value: Record<string, unknown>
    ): Promise<void> => {
      await storage.putObject({
        body: new TextEncoder().encode(JSON.stringify(value)),
        contentType: "application/json",
        key: keyFor(key),
      });
    },
  };
};
