import type { Actor } from "../../lib/contracts";
import type { Config } from "../config";
import { invariant } from "../errors";

// Platform authentication is the only shared server dependency. OMS data,
// capabilities and target connections remain inside this route module.
export async function requireIdentity(
  request: Request,
  config: Config,
  responseHeaders?: Headers
): Promise<Actor> {
  const { getCurrentSessionWithHeaders } = await import("@repo/auth/session");
  const { session, headers } = await getCurrentSessionWithHeaders(
    request.headers,
    {
      renew: false,
    }
  );
  for (const cookie of headers.getSetCookie()) {
    responseHeaders?.append("Set-Cookie", cookie);
  }
  invariant(
    session?.user,
    "unauthorized",
    "Sign in to Wizdek to continue.",
    401
  );
  invariant(
    new Date(session.session.expiresAt).getTime() > Date.now(),
    "unauthorized",
    "Your Wizdek session has expired.",
    401
  );
  const actor: Actor = {
    email: session.user.email,
    id: session.user.id,
    name: session.user.name,
  };
  invariant(
    config.allowedUsers.has(actor.id) ||
      config.policy.some((rule) => rule.userId === actor.id),
    "forbidden",
    "Management access has not been granted to your account.",
    403
  );
  return actor;
}
