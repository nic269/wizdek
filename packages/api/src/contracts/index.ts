export { apiContract } from "./base";
export { filesContract } from "./files";
export { healthContract } from "./health";
export { invitationsContract } from "./invitations";
export { jobsContract } from "./jobs";
export { organizationsContract } from "./organizations";
export { shopifyAppsContract } from "./shopify-apps";
export { shopifyStoresContract } from "./shopify-stores";

import { filesContract } from "./files";
import { healthContract } from "./health";
import { invitationsContract } from "./invitations";
import { jobsContract } from "./jobs";
import { organizationsContract } from "./organizations";
import { shopifyAppsContract } from "./shopify-apps";
import { shopifyStoresContract } from "./shopify-stores";

export const contract = {
  files: filesContract,
  health: healthContract,
  invitations: invitationsContract,
  jobs: jobsContract,
  organizations: organizationsContract,
  shopifyApps: shopifyAppsContract,
  shopifyStores: shopifyStoresContract,
};
