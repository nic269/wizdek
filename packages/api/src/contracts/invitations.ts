import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";

export const invitationsContract = {
  accept: apiContract
    .route({
      method: "POST",
      operationId: "invitations.accept",
      path: "/api/invitations/accept",
      summary: "Accept an organization invitation",
    })
    .input(z.object({ token: z.string().min(32).max(256) }))
    .output(
      dataEnvelope(
        z.object({
          organization: z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
          }),
        })
      )
    ),
};
