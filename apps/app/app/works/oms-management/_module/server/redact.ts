const SENSITIVE_KEY =
  /password|secret|token|signature|credential|authorization|cookie|connection.?string|database.?url|client.?key/i;
const STRUCTURED_VALUE = /^\s*[[{]/;
export function redact(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item),
      ])
    );
  }
  if (typeof value !== "string") {
    return value;
  }
  if (STRUCTURED_VALUE.test(value)) {
    try {
      return JSON.stringify(redact(JSON.parse(value)));
    } catch {
      /* Keep processing ordinary log text. */
    }
  }
  return value
    .replace(
      /(?:postgres(?:ql)?|mysql):\/\/[^\s"']+/gi,
      "[redacted connection]"
    )
    .replace(
      /(?:Bearer|Basic)\s+[a-zA-Z0-9._~+/=-]+/gi,
      "[redacted authorization]"
    )
    .replace(/\b(?:shpat_|shpca_|shpss_)[a-zA-Z0-9]+/g, "[redacted token]")
    .replace(
      /((?:password|secret|token|signature|authorization|cookie)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi,
      "$1[redacted]"
    );
}
