/**
 * Browser flags behind the dashboard's setup checklist. They are per-viewer
 * conveniences; the checklist's real progress comes from the API.
 */
export const onboardingHiddenKey = (organizationId: string) =>
  `wizdek.onboarding-hidden.${organizationId}`;

/** Set by the console after a query succeeds, for viewers without audit access. */
export const firstQueryKey = (organizationId: string) =>
  `wizdek.first-query.${organizationId}`;

export const readFlag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export const writeFlag = (key: string, value: boolean) => {
  try {
    if (value) {
      window.localStorage.setItem(key, "1");
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Without storage the flag lasts for this page only.
  }
};
