import { authFeatureConfig } from "@repo/config";
import { prisma } from "@repo/database";
import { type AuthSession, auth } from "./server";

export type SessionUser = AuthSession["user"];
export type ActiveAuthSession = AuthSession;

export const canUseAuthenticatedSession = (
  user: {
    emailVerified: boolean;
    status: string;
  },
  requireEmailVerification: boolean = authFeatureConfig.requireEmailVerification
) =>
  user.status === "ACTIVE" && (!requireEmailVerification || user.emailVerified);

export const isAuthenticated = (
  session: AuthSession | null | undefined
): session is ActiveAuthSession => Boolean(session?.user);

export const getCurrentSession = async (
  headers: Headers
): Promise<ActiveAuthSession | null> => {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    select: { emailVerified: true, status: true },
    where: { id: session.user.id },
  });

  return user && canUseAuthenticatedSession(user) ? session : null;
};
