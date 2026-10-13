import { isKnownPermission } from "@repo/access-control";
import {
  createRole,
  listAuditLogs,
  listMembers,
  listRoles,
  PaginationCursorError,
  updateMemberRole,
} from "@repo/auth/access-control";
import {
  createInvitation,
  InvitationError,
  listInvitations,
  revokeInvitation,
} from "@repo/auth/invitations";
import { keys } from "@repo/auth/keys";
import {
  createOrganizationForUser,
  isUniqueConstraintError,
  listOrganizationsForUser,
  normalizeOrganizationSlug,
} from "@repo/auth/organizations";
import { hasPermission } from "@repo/auth/permissions";
import { getCurrentSession } from "@repo/auth/session";
import { sendInvitationMail } from "@repo/mail";
import type { ApiContext } from "../context";
import { ApiError } from "../errors";
import { requireOrganizationInvitationsEnabled } from "../feature-guards";
import { os } from "./implementer";

const invitationErrorStatus = {
  INVITATION_EMAIL_MISMATCH: 403,
  INVITATION_EXPIRED: 410,
  INVITATION_NOT_FOUND: 404,
  INVITATION_NOT_PENDING: 409,
} as const;

const getDomainErrorCode = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof Error ? error.message : undefined;
};

const requireUser = async (headers: Headers) => {
  const session = await getCurrentSession(headers);
  if (!session) {
    throw new ApiError("UNAUTHORIZED", "Authentication required.", 401);
  }
  return session.user;
};

const requireOrganizationPermission = async (
  userId: string,
  organizationId: string,
  module: string,
  action: string,
  message = "You do not have permission for this organization action."
) => {
  if (!(await hasPermission({ action, module, organizationId, userId }))) {
    throw new ApiError("FORBIDDEN", message, 403);
  }
};

const requireValidPage = async <T>(query: Promise<T>) => {
  try {
    return await query;
  } catch (error) {
    if (error instanceof PaginationCursorError) {
      throw new ApiError("VALIDATION_ERROR", error.message, 422);
    }
    throw error;
  }
};

const createOrganization = os.organizations.create.handler(
  async ({ context, input }) => {
    const user = await requireUser(context.headers);
    const slug = normalizeOrganizationSlug(input.slug ?? input.name);
    if (!slug) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Organization slug must contain letters or numbers.",
        422
      );
    }

    try {
      return {
        data: await createOrganizationForUser({
          name: input.name,
          slug,
          userId: user.id,
        }),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ApiError(
          "CONFLICT",
          "That organization slug is already in use.",
          409
        );
      }
      throw error;
    }
  }
);

const listOrganizationInvitations = os.organizations.invitations.list.handler(
  async ({ context, input }) => {
    requireOrganizationInvitationsEnabled();
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "members",
      "read"
    );
    const page = await requireValidPage(
      listInvitations({
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        organizationId: input.organizationId,
      })
    );
    return { data: page.items, pageInfo: { nextCursor: page.nextCursor } };
  }
);

const createOrganizationInvitation =
  os.organizations.invitations.create.handler(async ({ context, input }) => {
    requireOrganizationInvitationsEnabled();
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "members",
      "invite"
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { invitation, organizationName, token } = await createInvitation({
      email: input.email,
      expiresAt,
      invitedById: user.id,
      organizationId: input.organizationId,
    });
    const acceptUrl = new URL(
      `/invite/${token}`,
      keys().NEXT_PUBLIC_APP_URL
    ).toString();
    let delivery: "sent" | "failed" = "sent";
    try {
      await sendInvitationMail({
        inviterName: user.name,
        inviteUrl: acceptUrl,
        organizationName,
        to: invitation.email,
      });
    } catch (error) {
      delivery = "failed";
      context.logger.error("invitation.delivery_failed", {
        invitationId: invitation.id,
        message: error instanceof Error ? error.message : "Unknown mail error",
      });
    }

    return {
      data: {
        acceptUrl,
        delivery,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        id: invitation.id,
        status: "PENDING" as const,
      },
    };
  });

const revokeOrganizationInvitation =
  os.organizations.invitations.revoke.handler(async ({ context, input }) => {
    requireOrganizationInvitationsEnabled();
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "members",
      "invite"
    );
    try {
      await revokeInvitation({
        actorId: user.id,
        invitationId: input.invitationId,
        organizationId: input.organizationId,
      });
    } catch (error) {
      if (error instanceof InvitationError) {
        throw new ApiError(
          error.code,
          error.message,
          invitationErrorStatus[error.code]
        );
      }
      throw error;
    }
  });

const createOrganizationRole = os.organizations.roles.create.handler(
  async ({ context, input }) => {
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "roles",
      "manage"
    );
    if (!input.permissions.every(isKnownPermission)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "One or more permissions are unknown.",
        422
      );
    }

    try {
      const role = await createRole({
        actorId: user.id,
        name: input.name,
        organizationId: input.organizationId,
        permissions: input.permissions,
        ...(input.description ? { description: input.description } : {}),
      });
      return { data: role };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ApiError(
          "CONFLICT",
          "That role already exists in this organization.",
          409
        );
      }
      throw error;
    }
  }
);

const listOrganizationRoles = os.organizations.roles.list.handler(
  async ({ context, input }) => {
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "roles",
      "read"
    );
    const page = await requireValidPage(
      listRoles({
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        organizationId: input.organizationId,
      })
    );
    return { data: page.items, pageInfo: { nextCursor: page.nextCursor } };
  }
);

const listOrganizationMembers = os.organizations.members.list.handler(
  async ({ context, input }) => {
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "members",
      "read"
    );
    const page = await requireValidPage(
      listMembers({
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        organizationId: input.organizationId,
      })
    );
    return {
      data: page.items.map((member) => ({
        ...member,
        status: "ACTIVE" as const,
      })),
      pageInfo: { nextCursor: page.nextCursor },
    };
  }
);

const updateOrganizationMemberRole =
  os.organizations.members.updateRole.handler(async ({ context, input }) => {
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "members",
      "manage"
    );
    try {
      await updateMemberRole({
        actorId: user.id,
        membershipId: input.membershipId,
        organizationId: input.organizationId,
        roleId: input.roleId,
      });
    } catch (error) {
      const errorCode = getDomainErrorCode(error);
      if (
        ["ROLE_NOT_FOUND", "MEMBERSHIP_NOT_FOUND"].includes(errorCode ?? "")
      ) {
        throw new ApiError(
          "NOT_FOUND",
          "Role or membership not found in this organization.",
          404
        );
      }
      if (errorCode === "LAST_OWNER_REQUIRED") {
        throw new ApiError(
          "CONFLICT",
          "An organization must keep at least one active Owner.",
          409
        );
      }
      if (errorCode === "OWNER_ROLE_REQUIRES_OWNER") {
        throw new ApiError(
          "FORBIDDEN",
          "Only an Owner or super admin can assign or remove the Owner role.",
          403
        );
      }
      if (errorCode === "OWNER_UPDATE_CONFLICT") {
        throw new ApiError(
          "CONFLICT",
          "The Owner role changed concurrently. Please retry.",
          409
        );
      }
      throw error;
    }
  });

const listOrganizationAuditLogs = os.organizations.auditLogs.handler(
  async ({ context, input }) => {
    const user = await requireUser(context.headers);
    await requireOrganizationPermission(
      user.id,
      input.organizationId,
      "audit",
      "read"
    );
    const page = await requireValidPage(
      listAuditLogs({
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit,
        organizationId: input.organizationId,
      })
    );
    return { data: page.items, pageInfo: { nextCursor: page.nextCursor } };
  }
);

export const organizationsRouter = {
  auditLogs: listOrganizationAuditLogs,
  create: createOrganization,
  invitations: {
    create: createOrganizationInvitation,
    list: listOrganizationInvitations,
    revoke: revokeOrganizationInvitation,
  },
  list: os.organizations.list.handler(async ({ context }) => {
    const user = await requireUser(context.headers);
    const organizations = await listOrganizationsForUser(user.id);
    return {
      data: organizations.map(({ memberships, ...organization }) => ({
        ...organization,
        role: memberships[0]?.role?.name ?? null,
      })),
    };
  }),
  members: {
    list: listOrganizationMembers,
    updateRole: updateOrganizationMemberRole,
  },
  roles: {
    create: createOrganizationRole,
    list: listOrganizationRoles,
  },
};

export const createApiContext = (
  headers: Headers,
  context: Pick<ApiContext, "logger" | "requestId">
): ApiContext => ({ headers, ...context });
