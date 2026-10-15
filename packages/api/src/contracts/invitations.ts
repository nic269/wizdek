import { z } from "zod";
import { apiContract, dataEnvelope } from "./base";

const invitationTokenInput = z.object({ token: z.string().min(32).max(256) });

export const invitationsContract = {
  accept: apiContract
    .route({
      method: "POST",
      operationId: "invitations.accept",
      path: "/api/invitations/accept",
      summary: "Accept an organization invitation",
    })
    .input(invitationTokenInput)
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
  preview: apiContract
    .route({
      method: "POST",
      operationId: "invitations.preview",
      path: "/api/invitations/preview",
      summary: "Describe an organization invitation before accepting it",
    })
    .input(invitationTokenInput)
    .output(
      dataEnvelope(
        z.object({
          connectedStoreCount: z.number().int().nonnegative(),
          email: z.email(),
          expiresAt: z.date(),
          invitedBy: z.object({ name: z.string() }).nullable(),
          organization: z.object({ id: z.string(), name: z.string() }),
          role: z.object({ name: z.string() }).nullable(),
          status: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]),
        })
      )
    ),
};
