import {
  acceptInvitation,
  InvitationError,
  type InvitationErrorCode,
} from "@repo/auth/invitations";
import { getCurrentSession } from "@repo/auth/session";
import { ApiError } from "../errors";
import { requireOrganizationInvitationsEnabled } from "../feature-guards";
import { os } from "./implementer";

const errorStatus: Record<InvitationErrorCode, 403 | 404 | 409 | 410> = {
  INVITATION_EMAIL_MISMATCH: 403,
  INVITATION_EXPIRED: 410,
  INVITATION_NOT_FOUND: 404,
  INVITATION_NOT_PENDING: 409,
};

export const invitationsRouter = {
  accept: os.invitations.accept.handler(async ({ context, input }) => {
    requireOrganizationInvitationsEnabled();
    const session = await getCurrentSession(context.headers);
    if (!session) {
      throw new ApiError("UNAUTHORIZED", "Authentication required.", 401);
    }

    try {
      const organization = await acceptInvitation({
        token: input.token,
        userEmail: session.user.email,
        userId: session.user.id,
      });
      return { data: { organization } };
    } catch (error) {
      if (error instanceof InvitationError) {
        throw new ApiError(
          error.code,
          error.message,
          errorStatus[error.code],
          undefined,
          { cause: error }
        );
      }
      throw error;
    }
  }),
};
