import { prisma } from "@repo/database";
import {
  buildTenantObjectKey,
  getStorageProvider,
  type StorageProvider,
} from "@repo/storage";
import { MAX_UPLOAD_BYTES } from "../engine/limits";
import { FlowServiceError } from "./errors";

export interface UploadedFlowFile {
  fileName: string;
  id: string;
  sizeBytes: number;
}

const CSV_EXTENSION = /\.csv$/i;
const CSV_CONTENT_TYPES = new Set([
  "",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

const rejected = (message: string) =>
  new FlowServiceError("UPLOAD_REJECTED", message);

/**
 * Stores a CSV file to be used as a flow input. Only CSV text is accepted:
 * the name must end in .csv, and the content must not be binary.
 */
export const uploadFlowFile = async (
  input: {
    actorId: string;
    body: Uint8Array;
    contentType: string;
    fileName: string;
    organizationId: string;
  },
  storage: StorageProvider = getStorageProvider()
): Promise<UploadedFlowFile> => {
  const contentType =
    input.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    !(CSV_EXTENSION.test(input.fileName) && CSV_CONTENT_TYPES.has(contentType))
  ) {
    throw rejected("Only CSV files can be uploaded.");
  }
  if (input.body.byteLength === 0) {
    throw rejected("The file is empty.");
  }
  if (input.body.byteLength > MAX_UPLOAD_BYTES) {
    throw rejected("The file is larger than the 10 MB limit.");
  }
  if (input.body.includes(0)) {
    throw rejected("The file does not look like CSV text.");
  }

  const stored = await storage.putObject({
    body: input.body,
    contentType: "text/csv",
    key: buildTenantObjectKey({
      fileName: input.fileName,
      organizationId: input.organizationId,
    }),
  });
  const asset = await prisma.fileAsset.create({
    data: {
      contentType: "text/csv",
      fileName: input.fileName,
      metadata: { purpose: "flow-input" },
      objectKey: stored.key,
      organizationId: input.organizationId,
      ownerId: input.actorId,
      provider: stored.provider,
      sizeBytes: BigInt(stored.sizeBytes),
    },
  });
  return {
    fileName: asset.fileName,
    id: asset.id,
    sizeBytes: stored.sizeBytes,
  };
};
