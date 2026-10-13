const ENCODED_SEPARATOR_OR_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i;
const hasRawControl = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

export const safeAuthCallbackUrl = (
  value: string | null | undefined,
  fallback = "/dashboard"
) => {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasRawControl(value) ||
    ENCODED_SEPARATOR_OR_CONTROL.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://app.invalid");
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) {
      return fallback;
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
};
