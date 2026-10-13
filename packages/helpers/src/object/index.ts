export const pick = <T extends Record<string, unknown>, K extends keyof T>(
  object: T,
  keys: readonly K[]
): Pick<T, K> =>
  Object.fromEntries(keys.map((key) => [key, object[key]])) as Pick<T, K>;

export const omitUndefined = <T extends Record<string, unknown>>(
  object: T
): Partial<T> =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
