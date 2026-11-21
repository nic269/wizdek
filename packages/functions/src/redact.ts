import { ENV_VAR_LIMITS } from "./definition";

export const REDACTED = "[redacted]";

/** The values worth scrubbing, longest first so a longer one wins. */
const scrubbable = (values: Iterable<string>): string[] =>
  [...new Set(values)]
    .filter(
      (value) =>
        value.length >= ENV_VAR_LIMITS.scrubMinLength &&
        !REDACTED.includes(value)
    )
    .sort((a, b) => b.length - a.length);

const replaceAll = (text: string, secrets: readonly string[]): string => {
  let scrubbed = text;
  for (const secret of secrets) {
    scrubbed = scrubbed.split(secret).join(REDACTED);
  }
  return scrubbed;
};

/** Replaces each secret value in a text. */
export const scrubText = (text: string, values: Iterable<string>): string =>
  replaceAll(text, scrubbable(values));

/** Replaces each secret value in every string of a JSON value. */
export const scrubJson = (
  value: unknown,
  values: Iterable<string>
): unknown => {
  const secrets = scrubbable(values);
  if (secrets.length === 0) {
    return value;
  }
  const walk = (current: unknown): unknown => {
    if (typeof current === "string") {
      return replaceAll(current, secrets);
    }
    if (Array.isArray(current)) {
      return current.map(walk);
    }
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([key, item]) => [
          replaceAll(key, secrets),
          walk(item),
        ])
      );
    }
    return current;
  };
  return walk(value);
};

/**
 * Scrubs output that arrives in pieces. A secret split across two pieces is
 * still caught: the end of each piece that could start a secret is held back
 * until the next piece, or until `end`.
 */
export const createStreamScrubber = (values: Iterable<string>) => {
  const secrets = scrubbable(values);
  const hold = Math.max(0, (secrets[0]?.length ?? 0) - 1);
  let carry = "";
  return {
    /** Everything held back, scrubbed. */
    end(): string {
      const rest = carry;
      carry = "";
      return replaceAll(rest, secrets);
    },
    /** The part of the output so far that is safe to store. */
    push(text: string): string {
      if (secrets.length === 0) {
        return text;
      }
      const scrubbed = replaceAll(carry + text, secrets);
      const cut = Math.max(0, scrubbed.length - hold);
      carry = scrubbed.slice(cut);
      return scrubbed.slice(0, cut);
    },
  };
};
