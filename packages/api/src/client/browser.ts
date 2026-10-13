import { createApiClient } from "./shared";

export const apiClient = createApiClient({
  baseUrl: () => {
    if (typeof window === "undefined") {
      throw new Error("The browser API client is not available on the server.");
    }
    return window.location.origin;
  },
});
