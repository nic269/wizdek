export const appConfig = {
  afterLoginPath: "/dashboard",
  afterLogoutPath: "/sign-in",
  dashboardPath: "/dashboard",
  defaultLocale: "en",
  description:
    "Developer tools for teams that work across many Shopify stores.",
  name: "Wizloft devkit",
  /** The short name, shown next to the version under the brand. */
  shortName: "wizdek",
  supportEmail: "support@example.com",
  /** Shown as "wizdek · v2.4" under the brand; a fixed label for now. */
  versionLabel: "v2.4",
} as const;

export const appSurfaces: readonly string[] = ["apps/app", "apps/api"];
