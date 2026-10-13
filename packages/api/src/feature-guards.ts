import { authFeatureConfig } from "@repo/config";
import { ApiError } from "./errors";

const PASSWORD_RESET_PATHS = new Set([
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
]);
const EMAIL_VERIFICATION_PATHS = new Set([
  "/api/auth/send-verification-email",
  "/api/auth/verify-email",
]);
const PASSWORD_RESET_CALLBACK_PREFIX = "/api/auth/reset-password/";

const featureNotFound = (message: string): never => {
  throw new ApiError("NOT_FOUND", message, 404);
};

export const requireAuthEndpointEnabled = (path: string) => {
  if (
    !authFeatureConfig.passwordReset &&
    (PASSWORD_RESET_PATHS.has(path) ||
      path.startsWith(PASSWORD_RESET_CALLBACK_PREFIX))
  ) {
    featureNotFound("Password reset is not available.");
  }
  if (
    !authFeatureConfig.requireEmailVerification &&
    EMAIL_VERIFICATION_PATHS.has(path)
  ) {
    featureNotFound("Email verification is not available.");
  }
};

export const requireOrganizationInvitationsEnabled = () => {
  if (!authFeatureConfig.organizationInvitations) {
    featureNotFound("Organization invitations are not available.");
  }
};
