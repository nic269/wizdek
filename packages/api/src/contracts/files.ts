import { z } from "zod";
import { apiContract, dataEnvelope, emptyInputSchema } from "./base";

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
};
