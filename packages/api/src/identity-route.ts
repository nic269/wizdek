import { getCurrentSessionWithHeaders } from "@repo/auth/session";
import type { Context } from "hono";

/** Generic identity boundary for separately deployed first-party applications. */
export const handleIdentity = async (context: Context) => {
  const { session, headers } = await getCurrentSessionWithHeaders(
    context.req.raw.headers,
    { renew: context.req.query("renew") !== "false" }
  );
  context.header("Cache-Control", "private, no-store");
  context.header("Vary", "Cookie");
  for (const cookie of headers.getSetCookie()) {
    context.header("Set-Cookie", cookie, { append: true });
  }
  if (!session) {
    return context.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required." } },
      401
    );
  }
  return context.json({
    expiresAt: session.session.expiresAt,
    user: {
      email: session.user.email,
      id: session.user.id,
      name: session.user.name,
    },
  });
};
