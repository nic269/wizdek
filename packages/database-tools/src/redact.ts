const REDACTED = "[redacted]";

// The user-info part of any URL, e.g. "postgresql://user:secret@".
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi;

/**
 * Removes the given secrets, and the credentials of any URL, from text that
 * came from a database driver or tool and is about to be stored or logged.
 */
export const redactSecrets = (
  text: string,
  secrets: readonly string[] = []
): string => {
  let redacted = text;
  // Longest first, so a URL is removed whole before its password is.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  return redacted.replace(URL_CREDENTIALS, `$1${REDACTED}@`);
};

/** The secrets to scrub from anything derived from a connection URL. */
export const secretsOf = (url: string, password: string): string[] => [
  url,
  password,
  encodeURIComponent(password),
];
