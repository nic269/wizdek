export const MANAGEMENT_ROOT = "/works/oms-management";
export const SECTION_PATHS = {
  cron: "/settings/site-config/cronjobs",
  logs: "/debug-logs",
  maintenance: "/settings/site-config",
  overview: "",
  tools: "/settings/site-config/tools",
} as const;
export type ManagementSection = keyof typeof SECTION_PATHS;
export function managementHref(section: ManagementSection, profileId?: string) {
  const path = MANAGEMENT_ROOT + SECTION_PATHS[section];
  return profileId
    ? `${path}?${new URLSearchParams({ profile: profileId })}`
    : path;
}
export function sectionForPath(
  segments: string[]
): ManagementSection | undefined {
  const path = segments.length ? `/${segments.join("/")}` : "";
  return (Object.entries(SECTION_PATHS) as [ManagementSection, string][]).find(
    ([, value]) => value === path
  )?.[0];
}
