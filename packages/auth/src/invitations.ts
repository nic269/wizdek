import { createHash, randomBytes } from "node:crypto";
import { prisma, syncSystemRoles } from "@repo/database";
import { cursorDate, decodeCursor, type PageInput, toPage } from "./pagination";

export type InvitationErrorCode =
  | "INVITATION_NOT_FOUND"
  | "INVITATION_NOT_PENDING"
  | "INVITATION_EXPIRED"
  | "INVITATION_EMAIL_MISMATCH";

export class InvitationError extends Error {
  readonly code: InvitationErrorCode;

  constructor(code: InvitationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const normalizeInvitationEmail = (email: string) =>
  email.trim().toLowerCase();

export const hashInvitationToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const createInvitationToken = () =>
  randomBytes(32).toString("base64url");

export const listInvitations = async (input: PageInput) => {
  const cursor = decodeCursor(input.cursor, "invitations");
  const cursorCreatedAt = cursor ? cursorDate(cursor.sort) : undefined;
  await prisma.invitation.updateMany({
    data: { status: "EXPIRED" },
    where: {
      expiresAt: { lte: new Date() },
      organizationId: input.organizationId,
      status: "PENDING",
    },
  });
  const rows = await prisma.invitation.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      createdAt: true,
      email: true,
      expiresAt: true,
      id: true,
      invitedBy: { select: { name: true } },
      status: true,
    },
    take: input.limit + 1,
    where: {
      organizationId: input.organizationId,
      ...(cursor && cursorCreatedAt
        ? {
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              { createdAt: cursorCreatedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
  });
  return toPage(rows, input.limit, (invitation) => ({
    id: invitation.id,
    kind: "invitations",
    sort: invitation.createdAt.toISOString(),
  }));
};

export const createInvitation = async (input: {
  organizationId: string;
  email: string;
  invitedById: string;
  expiresAt: Date;
}) => {
  const token = createInvitationToken();
  const email = normalizeInvitationEmail(input.email);

  const persistInvitation = () =>
    prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.findUniqueOrThrow({
        select: { name: true },
        where: { id: input.organizationId },
      });
      let memberRole = await transaction.role.findUnique({
        select: { id: true },
        where: {
          organizationId_name: {
            name: "Member",
            organizationId: input.organizationId,
          },
        },
      });
      if (!memberRole) {
        const roles = await syncSystemRoles(transaction, input.organizationId);
        memberRole = roles.Member;
      }

      const pending = await transaction.invitation.findFirst({
        select: { id: true },
        where: {
          email,
          organizationId: input.organizationId,
          status: "PENDING",
        },
      });

      const data = {
        expiresAt: input.expiresAt,
        invitedById: input.invitedById,
        roleId: memberRole.id,
        tokenHash: hashInvitationToken(token),
      };
      const created = pending
        ? await transaction.invitation.update({
            data,
            where: { id: pending.id },
          })
        : await transaction.invitation.create({
            data: { ...data, email, organizationId: input.organizationId },
          });

      await transaction.auditLog.create({
        data: {
          action: "invitation.created",
          actorId: input.invitedById,
          metadata: { email, expiresAt: input.expiresAt.toISOString() },
          organizationId: input.organizationId,
          targetId: created.id,
          targetType: "Invitation",
        },
      });

      return { invitation: created, organizationName: organization.name };
    });

  const result = await persistInvitation().catch((error: unknown) => {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    return persistInvitation();
  });

  return { ...result, token };
};

const isUniqueConstraintError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

export const revokeInvitation = (input: {
  organizationId: string;
  invitationId: string;
  actorId: string;
}) =>
  prisma.$transaction(async (transaction) => {
    const result = await transaction.invitation.updateMany({
      data: { revokedAt: new Date(), status: "REVOKED" },
      where: {
        id: input.invitationId,
        organizationId: input.organizationId,
        status: "PENDING",
      },
    });
    if (result.count === 0) {
      throw new InvitationError(
        "INVITATION_NOT_PENDING",
        "Pending invitation not found."
      );
    }

    await transaction.auditLog.create({
      data: {
        action: "invitation.revoked",
        actorId: input.actorId,
        organizationId: input.organizationId,
        targetId: input.invitationId,
        targetType: "Invitation",
      },
    });
  });

export const acceptInvitation = async (input: {
  token: string;
  userId: string;
  userEmail: string;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  const result = await prisma.$transaction(async (transaction) => {
    const invitation = await transaction.invitation.findUnique({
      select: {
        email: true,
        expiresAt: true,
        id: true,
        organization: { select: { name: true, slug: true } },
        organizationId: true,
        roleId: true,
        status: true,
      },
      where: { tokenHash: hashInvitationToken(input.token) },
    });

    if (!invitation) {
      throw new InvitationError(
        "INVITATION_NOT_FOUND",
        "Invitation not found."
      );
    }
    if (invitation.status === "EXPIRED") {
      return { kind: "expired" as const };
    }
    if (invitation.status !== "PENDING") {
      throw new InvitationError(
        "INVITATION_NOT_PENDING",
        "Invitation is no longer pending."
      );
    }
    if (invitation.expiresAt <= now) {
      const transition = await transaction.invitation.updateMany({
        data: { status: "EXPIRED" },
        where: {
          expiresAt: { lte: now },
          id: invitation.id,
          status: "PENDING",
        },
      });
      if (transition.count === 0) {
        const current = await transaction.invitation.findUnique({
          select: { status: true },
          where: { id: invitation.id },
        });
        if (current?.status !== "EXPIRED") {
          throw new InvitationError(
            "INVITATION_NOT_PENDING",
            "Invitation is no longer pending."
          );
        }
      }
      return { kind: "expired" as const };
    }
    if (invitation.email !== normalizeInvitationEmail(input.userEmail)) {
      throw new InvitationError(
        "INVITATION_EMAIL_MISMATCH",
        "Sign in with the email address that was invited."
      );
    }

    const transition = await transaction.invitation.updateMany({
      data: { acceptedAt: now, status: "ACCEPTED" },
      where: { id: invitation.id, status: "PENDING" },
    });
    if (transition.count === 0) {
      throw new InvitationError(
        "INVITATION_NOT_PENDING",
        "Invitation is no longer pending."
      );
    }

    await transaction.membership.upsert({
      create: {
        organizationId: invitation.organizationId,
        roleId: invitation.roleId,
        status: "ACTIVE",
        userId: input.userId,
      },
      update: { roleId: invitation.roleId, status: "ACTIVE" },
      where: {
        userId_organizationId: {
          organizationId: invitation.organizationId,
          userId: input.userId,
        },
      },
    });

    await transaction.auditLog.create({
      data: {
        action: "invitation.accepted",
        actorId: input.userId,
        metadata: { email: invitation.email },
        organizationId: invitation.organizationId,
        targetId: invitation.id,
        targetType: "Invitation",
      },
    });

    return {
      kind: "accepted" as const,
      organization: {
        id: invitation.organizationId,
        ...invitation.organization,
      },
    };
  });

  if (result.kind === "expired") {
    throw new InvitationError("INVITATION_EXPIRED", "Invitation has expired.");
  }
  return result.organization;
};
