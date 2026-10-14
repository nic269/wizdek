import { Readable, Transform } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "../provider";

// Multipart parts held in memory at once: STREAM_PART_BYTES * STREAM_QUEUE_SIZE.
const STREAM_PART_BYTES = 8 * 1024 * 1024;
const STREAM_QUEUE_SIZE = 2;

export interface S3StorageConfig {
  accessKeyId?: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  region: string;
  secretAccessKey?: string;
}

type S3StorageConfigInput = {
  [Key in keyof S3StorageConfig]?: S3StorageConfig[Key] | undefined;
};

export const isS3StorageConfigured = (config: S3StorageConfigInput) =>
  Boolean(
    config.bucket &&
      config.region &&
      config.accessKeyId &&
      config.secretAccessKey
  );

export const createS3StorageProvider = (
  config: S3StorageConfig
): StorageProvider => {
  if (!isS3StorageConfigured(config)) {
    throw new Error(
      "S3 storage requires bucket, region, access key, and secret key."
    );
  }

  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId ?? "",
      secretAccessKey: config.secretAccessKey ?? "",
    },
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    region: config.region,
    // By default the SDK opens multipart uploads with a CRC32 checksum, and
    // lib-storage then completes them without the per-part checksums, which
    // the server rejects. Checksums are sent only where an operation needs one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  });

  return {
    async deleteObject(input) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: input.key })
      );
    },
    async getObject(input) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: input.key })
      );
      const body = response.Body
        ? new Uint8Array(await response.Body.transformToByteArray())
        : new Uint8Array();
      return {
        body,
        contentType: response.ContentType ?? "application/octet-stream",
        key: input.key,
        provider: "s3",
        sizeBytes: body.byteLength,
      };
    },
    async getObjectStream(input) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: input.key })
      );
      if (!(response.Body instanceof Readable)) {
        throw new Error(`S3 returned no readable body for ${input.key}.`);
      }
      return {
        body: response.Body,
        contentType: response.ContentType ?? "application/octet-stream",
        key: input.key,
        provider: "s3",
        sizeBytes: response.ContentLength ?? 0,
      };
    },
    async getSignedDownloadUrl(input) {
      const expiresInSeconds = input.expiresInSeconds ?? 900;
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
      });
      return {
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        url: await getSignedUrl(client, command, {
          expiresIn: expiresInSeconds,
        }),
      };
    },
    async getSignedUploadUrl(input) {
      const expiresInSeconds = input.expiresInSeconds ?? 900;
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        ContentType: input.contentType,
        Key: input.key,
        ServerSideEncryption: "AES256",
      });
      return {
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        headers: {
          "content-type": input.contentType,
          "x-amz-server-side-encryption": "AES256",
        },
        url: await getSignedUrl(client, command, {
          expiresIn: expiresInSeconds,
        }),
      };
    },
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: config.bucket,
          ContentType: input.contentType,
          Key: input.key,
          Metadata: input.metadata,
          ServerSideEncryption: "AES256",
        })
      );

      return {
        contentType: input.contentType,
        key: input.key,
        provider: "s3",
        sizeBytes: input.body.byteLength,
      };
    },
    async putObjectStream(input) {
      let sizeBytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.byteLength;
          callback(null, chunk);
        },
      });
      input.body.once("error", (error) => counter.destroy(error));
      const upload = new Upload({
        client,
        // Aborts the multipart upload on failure, so no partial object or
        // orphaned parts remain.
        leavePartsOnError: false,
        params: {
          Body: input.body.pipe(counter),
          Bucket: config.bucket,
          ContentType: input.contentType,
          Key: input.key,
          Metadata: input.metadata,
          ServerSideEncryption: "AES256",
        },
        partSize: STREAM_PART_BYTES,
        queueSize: STREAM_QUEUE_SIZE,
      });
      await upload.done();
      return {
        contentType: input.contentType,
        key: input.key,
        provider: "s3",
        sizeBytes,
      };
    },
  };
};
