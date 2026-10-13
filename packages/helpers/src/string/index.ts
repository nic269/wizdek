const WHITESPACE_PATTERN = /\s+/;

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const titleCase = (value: string) =>
  value
    .split(WHITESPACE_PATTERN)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
