import type { Readable } from "node:stream";

export interface PutObjectInput {
  body: Uint8Array;
  contentType: string;
  key: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  contentType: string;
  key: string;
  provider: string;
  sizeBytes: number;
}

export interface GetObjectInput {
  key: string;
}

export type StoredObjectBody = StoredObject & {
  body: Uint8Array;
};

/**
 * Writes an object of unknown length without holding it in memory. When the
 * body fails or the upload is rejected, no object is left at the key.
 */
export interface PutObjectStreamInput {
  body: Readable;
  contentType: string;
  key: string;
  metadata?: Record<string, string>;
}

export type StoredObjectStream = StoredObject & {
  body: Readable;
};

export interface DeleteObjectInput {
  key: string;
}

export interface SignedUploadInput {
  contentType: string;
  expiresInSeconds?: number;
  key: string;
}

export interface SignedDownloadInput {
  expiresInSeconds?: number;
  key: string;
}

export interface SignedUpload {
  expiresAt: Date;
  headers?: Record<string, string>;
  url: string;
}

export interface SignedDownload {
  expiresAt: Date;
  url: string;
}

export interface StorageProvider {
  deleteObject(input: DeleteObjectInput): Promise<void>;
  getObject(input: GetObjectInput): Promise<StoredObjectBody>;
  getObjectStream(input: GetObjectInput): Promise<StoredObjectStream>;
  getSignedDownloadUrl?(input: SignedDownloadInput): Promise<SignedDownload>;
  getSignedUploadUrl?(input: SignedUploadInput): Promise<SignedUpload>;
  putObject(input: PutObjectInput): Promise<StoredObject>;
  putObjectStream(input: PutObjectStreamInput): Promise<StoredObject>;
}

export const sanitizeObjectKeySegment = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120) || "file";

export const buildTenantObjectKey = (input: {
  organizationId?: string;
  ownerId?: string;
  fileName: string;
}) => {
  let scope = "global";
  if (input.organizationId) {
    scope = `org/${sanitizeObjectKeySegment(input.organizationId)}`;
  } else if (input.ownerId) {
    scope = `user/${sanitizeObjectKeySegment(input.ownerId)}`;
  }
  return `${scope}/${crypto.randomUUID()}-${sanitizeObjectKeySegment(input.fileName)}`;
};
