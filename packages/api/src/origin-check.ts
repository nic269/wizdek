import { keys } from "@repo/auth/keys";
import type { Context, Next } from "hono";
import { ApiError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses state-changing requests that a browser sent from another site.
 * Browsers attach `Origin` to cross-site writes, so a present header that is
 * not the app's own origin is rejected. Requests without the header (server
 * to server, tests) rely on the session checks alone.
 */
export const requireAppOrigin = async (context: Context, next: Next) => {
  const origin = context.req.header("origin");
  if (
    origin &&
    !SAFE_METHODS.has(context.req.method) &&
    origin !== new URL(keys().NEXT_PUBLIC_APP_URL).origin
  ) {
    throw new ApiError(
      "FORBIDDEN",
      "This request was sent from an origin that is not allowed.",
      403
    );
  }
  await next();
};
