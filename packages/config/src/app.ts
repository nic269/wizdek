export const appConfig = {
  afterLoginPath: "/dashboard",
  afterLogoutPath: "/sign-in",
  dashboardPath: "/dashboard",
  defaultLocale: "en",
  description:
    "A modern, generic SaaS foundation for Anh Nguyen's future apps.",
  name: "Shopify Toolkit",
  supportEmail: "support@example.com",
} as const;

export const appSurfaces: readonly string[] = ["apps/app", "apps/api"];
