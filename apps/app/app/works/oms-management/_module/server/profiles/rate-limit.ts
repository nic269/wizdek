import { invariant } from "../errors";

const attempts = new Map<string, { count: number; until: number }>();
export function limitConnectionTests(actorId: string) {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (value.until < now) {
      attempts.delete(key);
    }
  }
  const bucket = attempts.get(actorId) ?? { count: 0, until: now + 60_000 };
  invariant(
    bucket.count < 10,
    "rate_limited",
    "Too many connection changes. Wait a minute before trying again.",
    429
  );
  bucket.count += 1;
  attempts.set(actorId, bucket);
}
