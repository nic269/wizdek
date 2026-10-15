import {
  acceptInvitation,
  InvitationError,
  type InvitationErrorCode,
  previewInvitation,
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

const toApiError = (error: unknown) =>
  error instanceof InvitationError
    ? new ApiError(
        error.code,
        error.message,
        errorStatus[error.code],
        undefined,
        {
          cause: error,
        }
      )
    : error;

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
      throw toApiError(error);
    }
  }),
  // The token is the secret the invite link carries, so its holder may read
  // what they were invited to before signing in.
  preview: os.invitations.preview.handler(async ({ input }) => {
    requireOrganizationInvitationsEnabled();
    try {
      return { data: await previewInvitation({ token: input.token }) };
    } catch (error) {
      throw toApiError(error);
    }
  }),
};
