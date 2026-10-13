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
