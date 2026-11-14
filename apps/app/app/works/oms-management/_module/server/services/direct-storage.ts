import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { invariant, ManagementError } from "../errors";
import type { Connection } from "../profiles/schema";
import { type DirectStorage, directResources } from "./direct-config";

const STORAGE_URI = /^s3:\/\/([^/]+)\/(.+)$/;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export function objectLocation(uri: string, config: DirectStorage) {
  const match = STORAGE_URI.exec(uri);
  invariant(
    match &&
      match[1] === config.bucket &&
      match[2]?.startsWith(`${config.prefix}/`) &&
      !match[2].split("/").some((part) => part === ".." || part === "."),
    "storage_scope_denied",
    "This file is outside the selected database storage scope.",
    403
  );
  return { Bucket: match[1], Key: match[2] };
}

export async function boundedObjectBody(
  body: unknown,
  contentLength?: number
): Promise<Buffer> {
  const stream = body as AsyncIterable<Uint8Array> & { destroy?: () => void };
  try {
    invariant(
      contentLength === undefined || contentLength <= MAX_FILE_BYTES,
      "file_size_limit",
      "The original file exceeds the 50 MB download limit.",
      413
    );
    invariant(
      stream && typeof stream[Symbol.asyncIterator] === "function",
      "storage_body_invalid",
      "Object storage returned an invalid file body.",
      502
    );
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      invariant(
        length <= MAX_FILE_BYTES,
        "file_size_limit",
        "The original file exceeds the 50 MB download limit.",
        413
      );
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    stream?.destroy?.();
    throw error;
  }
}

export async function directObject(connection: Connection, uri: string) {
  const config = directResources(connection).storage;
  invariant(
    config,
    "storage_not_configured",
    "Configure object storage for this OMS database before downloading its files.",
    409
  );
  const location = objectLocation(uri, config);
  const client = new S3Client({
    ...(config.credentials
      ? {
          credentials: {
            accessKeyId: config.credentials.accessKeyId,
            secretAccessKey: config.credentials.secretAccessKey,
            ...(config.credentials.sessionToken
              ? { sessionToken: config.credentials.sessionToken }
              : {}),
          },
        }
      : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    maxAttempts: 2,
    region: config.region,
  });
  try {
    const response = await client.send(new GetObjectCommand(location), {
      abortSignal: AbortSignal.timeout(30_000),
    });
    return {
      content: await boundedObjectBody(response.Body, response.ContentLength),
      contentType: response.ContentType,
    };
  } catch (error) {
    if (error instanceof ManagementError) {
      throw error;
    }
    throw new ManagementError(
      "storage_download_failed",
      "The original file could not be downloaded from object storage.",
      502
    );
  } finally {
    client.destroy();
  }
}
