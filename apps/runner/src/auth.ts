import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether an Authorization header carries the agent's token. Both sides are
 * hashed first so the comparison takes the same time for any input length.
 */
export const isAuthorized = (
  header: string | undefined,
  token: string
): boolean => {
  if (!header?.startsWith(BEARER_PREFIX)) {
    return false;
  }
  return timingSafeEqual(
    digest(header.slice(BEARER_PREFIX.length)),
    digest(token)
  );
};
