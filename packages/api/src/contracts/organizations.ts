import { type KnownPermission, PERMISSION_CATALOG } from "@repo/access-control";
import { z } from "zod";
import {
  apiContract,
  cursorPaginationInputSchema,
  dataEnvelope,
  emptyInputSchema,
  paginatedDataEnvelope,
} from "./base";

const permissionPairSchemas = PERMISSION_CATALOG.map(({ action, module }) =>
  z.object({ action: z.literal(action), module: z.literal(module) })
);

export const permissionSchema = z.union(
  permissionPairSchemas as [
    (typeof permissionPairSchemas)[number],
    (typeof permissionPairSchemas)[number],
    ...(typeof permissionPairSchemas)[number][],
  ]
) as z.ZodType<KnownPermission>;

export const invitationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);

export const membershipStatusSchema = z.enum(["ACTIVE", "INVITED", "DISABLED"]);

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  slug: z.string(),
});

export const invitationSchema = z.object({
  createdAt: z.date(),
  email: z.email(),
  expiresAt: z.date(),
  id: z.string(),
  invitedBy: z.object({ name: z.string() }).nullable(),
  status: invitationStatusSchema,
});

export const createdInvitationSchema = z.object({
  acceptUrl: z.url(),
  delivery: z.enum(["sent", "failed"]),
  email: z.email(),
  expiresAt: z.date(),
  id: z.string(),
  status: z.literal("PENDING"),
});

export const roleSchema = z.object({
  _count: z.object({ memberships: z.number().int().nonnegative() }),
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  permissions: z.array(permissionSchema),
});

export const memberSchema = z.object({
  createdAt: z.date(),
  id: z.string(),
  role: z.object({ id: z.string(), name: z.string() }).nullable(),
  status: z.literal("ACTIVE"),
  user: z.object({ email: z.email(), id: z.string(), name: z.string() }),
});

export const auditLogSchema = z.object({
  action: z.string(),
  actor: z.object({ email: z.email(), name: z.string() }).nullable(),
  createdAt: z.date(),
  id: z.string(),
  metadata: z.unknown(),
  targetId: z.string().nullable(),
  targetType: z.string().nullable(),
});

const organizationIdInput = z.object({ organizationId: z.string().min(1) });
const organizationPageInput = organizationIdInput.extend(
  cursorPaginationInputSchema.shape
);

export const organizationsContract = {
  auditLogs: apiContract
    .route({
      method: "GET",
      operationId: "organizations.auditLogs.list",
      path: "/api/organizations/{organizationId}/audit-logs",
      summary: "List organization audit logs",
    })
    .input(organizationPageInput)
    .output(paginatedDataEnvelope(auditLogSchema)),
  create: apiContract
    .route({
      method: "POST",
      operationId: "organizations.create",
      path: "/api/organizations",
      successStatus: 201,
      summary: "Create an organization",
    })
    .input(
      z.object({
        name: z.string().trim().min(2).max(80),
        slug: z.string().trim().max(80).optional(),
      })
    )
    .output(dataEnvelope(organizationSchema)),
  invitations: {
    create: apiContract
      .route({
        method: "POST",
        operationId: "organizations.invitations.create",
        path: "/api/organizations/{organizationId}/invitations",
        successStatus: 201,
        summary: "Invite an organization member",
      })
      .input(organizationIdInput.extend({ email: z.email().trim().max(254) }))
      .output(dataEnvelope(createdInvitationSchema)),
    list: apiContract
      .route({
        method: "GET",
        operationId: "organizations.invitations.list",
        path: "/api/organizations/{organizationId}/invitations",
        summary: "List organization invitations",
      })
      .input(organizationPageInput)
      .output(paginatedDataEnvelope(invitationSchema)),
    revoke: apiContract
      .route({
        method: "DELETE",
        operationId: "organizations.invitations.revoke",
        path: "/api/organizations/{organizationId}/invitations/{invitationId}",
        successStatus: 204,
        summary: "Revoke an organization invitation",
      })
      .input(organizationIdInput.extend({ invitationId: z.string().min(1) }))
      .output(z.void()),
  },
  list: apiContract
    .route({
      method: "GET",
      operationId: "organizations.list",
      path: "/api/organizations",
      summary: "List organizations for the current user",
    })
    .input(emptyInputSchema)
    .output(dataEnvelope(z.array(organizationSchema))),
  members: {
    list: apiContract
      .route({
        method: "GET",
        operationId: "organizations.members.list",
        path: "/api/organizations/{organizationId}/members",
        summary: "List organization members",
      })
      .input(organizationPageInput)
      .output(paginatedDataEnvelope(memberSchema)),
    updateRole: apiContract
      .route({
        method: "PATCH",
        operationId: "organizations.members.updateRole",
        path: "/api/organizations/{organizationId}/members/{membershipId}/role",
        successStatus: 204,
        summary: "Update an organization member role",
      })
      .input(
        organizationIdInput.extend({
          membershipId: z.string().min(1),
          roleId: z.string().min(1),
        })
      )
      .output(z.void()),
  },
  roles: {
    create: apiContract
      .route({
        method: "POST",
        operationId: "organizations.roles.create",
        path: "/api/organizations/{organizationId}/roles",
        successStatus: 201,
        summary: "Create an organization role",
      })
      .input(
        organizationIdInput.extend({
          description: z.string().trim().max(160).optional(),
          name: z.string().trim().min(2).max(40),
          permissions: z.array(permissionSchema).min(1),
        })
      )
      .output(dataEnvelope(roleSchema)),
    list: apiContract
      .route({
        method: "GET",
        operationId: "organizations.roles.list",
        path: "/api/organizations/{organizationId}/roles",
        summary: "List organization roles",
      })
      .input(organizationPageInput)
      .output(paginatedDataEnvelope(roleSchema)),
  },
};
