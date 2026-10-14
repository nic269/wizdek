import { cn } from "../lib/cn";

const WHITESPACE_PATTERN = /[\s._-]+/;

/** The hues stores are drawn in; a stable hash of the id picks one. */
const IDENTITY_HUES = [25, 250, 70, 300, 170] as const;

export const hueFromId = (id: string) => {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2_147_483_647;
  }
  return IDENTITY_HUES[hash % IDENTITY_HUES.length] ?? IDENTITY_HUES[0];
};

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(WHITESPACE_PATTERN)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "?";

/** A store, database or organization mark: initials on a tint of its hue. */
export const IdentityChip = ({
  id,
  name,
  size = 30,
  className,
}: {
  id: string;
  name: string;
  size?: number | undefined;
  className?: string | undefined;
}) => {
  const hue = hueFromId(id);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center font-semibold leading-none",
        className
      )}
      style={{
        background: `oklch(0.95 0.035 ${hue})`,
        borderRadius: size >= 28 ? 8 : 6,
        color: `oklch(0.5 0.13 ${hue})`,
        fontSize: Math.round(size * 0.37),
        height: size,
        width: size,
      }}
    >
      {initialsOf(name)}
    </span>
  );
};
