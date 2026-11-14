import { z } from "zod";
import { ManagementError } from "../errors";
import { databaseFingerprint } from "../oms-api/client";
import type { Connection } from "../profiles/schema";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const httpsResourceUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  });
const storageSchema = z
  .object({
    bucket: z.string().min(1),
    credentials: z
      .object({
        accessKeyId: z.string().min(1),
        secretAccessKey: z.string().min(1),
        sessionToken: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    endpoint: httpsResourceUrl.optional(),
    forcePathStyle: z.boolean().default(false),
    prefix: z
      .string()
      .min(1)
      .transform((value) => value.replace(/^\/+|\/+$/g, ""))
      .refine(Boolean),
    region: z.string().min(1),
  })
  .strict();
const resourcesSchema = z
  .object({
    encryptionKey: z.string().min(1).optional(),
    storage: storageSchema.optional(),
  })
  .strict();
export type DirectResources = z.infer<typeof resourcesSchema>;
export type DirectStorage = z.infer<typeof storageSchema>;

// Server-only configuration is keyed by DB identity coordinates, never selected by browser input.
export function directResources(connection: Connection): DirectResources {
  try {
    const configured = z
      .record(z.string().regex(FINGERPRINT), resourcesSchema)
      .parse(JSON.parse(process.env.OMS_DIRECT_RESOURCES_JSON ?? "{}"));
    return configured[databaseFingerprint(connection)] ?? {};
  } catch {
    throw new ManagementError(
      "direct_configuration_invalid",
      "OMS direct resource configuration is invalid.",
      503
    );
  }
}
