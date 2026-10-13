import { z } from "zod";
import { apiContract, dataEnvelope, emptyInputSchema } from "./base";
import { organizationIdInput } from "./shopify-shared";

export const MAX_UPLOAD_BYTES = 10_000_000;

export const filesContract = {
  status: apiContract
    .route({
      method: "GET",
      operationId: "files.status",
      path: "/api/files",
      summary: "Get storage provider status",
    })
    .input(emptyInputSchema)
    .output(
      z.object({
        ...dataEnvelope(
          z.object({
            configured: z.boolean(),
            mode: z.enum(["local", "durable", "ephemeral", "disabled"]),
            provider: z.enum(["local", "memory", "s3", "r2"]),
          })
        ).shape,
        message: z.string(),
      })
    ),
  upload: apiContract
    .route({
      method: "POST",
      operationId: "files.upload",
      path: "/api/organizations/{organizationId}/files",
      successStatus: 201,
      summary: "Upload a CSV file to use as a flow input",
    })
    .input(
      organizationIdInput.extend({
        file: z.file().max(MAX_UPLOAD_BYTES, "Files are limited to 10 MB."),
      })
    )
    .output(
      dataEnvelope(
        z.object({
          fileName: z.string(),
          id: z.string(),
          sizeBytes: z.number().int(),
        })
      )
    ),
};
