import { z } from "zod";
import { apiContract, emptyInputSchema } from "./base";

export const jobsContract = {
  status: apiContract
    .route({
      method: "GET",
      operationId: "jobs.status",
      path: "/api/jobs",
      summary: "Get job provider status",
    })
    .input(emptyInputSchema)
    .output(
      z.object({
        data: z.object({
          configured: z.boolean(),
          mode: z.enum(["ephemeral", "durable"]),
          provider: z.enum(["local", "pgboss"]),
        }),
        message: z.string(),
      })
    ),
};
