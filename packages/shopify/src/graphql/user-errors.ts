const USER_ERRORS_KEY = /(^u|U)serErrors$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Counts the user errors a mutation reported. Shopify returns them inside
 * each mutation payload, under `userErrors` or a prefixed variant such as
 * `customerUserErrors`, alongside an otherwise successful response.
 */
export const countUserErrors = (body: unknown): number => {
  if (!(isRecord(body) && isRecord(body.data))) {
    return 0;
  }
  let count = 0;
  for (const payload of Object.values(body.data)) {
    if (!isRecord(payload)) {
      continue;
    }
    for (const [key, value] of Object.entries(payload)) {
      if (USER_ERRORS_KEY.test(key) && Array.isArray(value)) {
        count += value.length;
      }
    }
  }
  return count;
};

/** Counts top-level GraphQL errors; a plain string error counts as one. */
export const countGraphqlErrors = (body: unknown): number => {
  if (!isRecord(body) || body.errors === undefined || body.errors === null) {
    return 0;
  }
  return Array.isArray(body.errors) ? body.errors.length : 1;
};
