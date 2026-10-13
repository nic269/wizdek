import type { GraphiQLProps } from "graphiql";

type ConsoleStorage = NonNullable<GraphiQLProps["storage"]>;

const ROOT = "graphql-console";

/**
 * A `localStorage` view limited to one user in one organization, so tabs,
 * history and settings never carry over between accounts or organizations
 * that share a browser.
 */
export const createConsoleStorage = (
  userId: string,
  organizationId: string
): ConsoleStorage => {
  const prefix = `${ROOT}:${userId}:${organizationId}:`;
  const ownKeys = () => {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  };

  return {
    clear: () => {
      for (const key of ownKeys()) {
        window.localStorage.removeItem(key);
      }
    },
    getItem: (key) => window.localStorage.getItem(prefix + key),
    get length() {
      return ownKeys().length;
    },
    removeItem: (key) => window.localStorage.removeItem(prefix + key),
    setItem: (key, value) => window.localStorage.setItem(prefix + key, value),
  };
};
