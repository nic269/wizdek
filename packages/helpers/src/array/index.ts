export const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

export const compact = <T>(
  items: readonly (T | null | undefined | false)[]
): T[] => items.filter((item): item is T => Boolean(item));
