import { filesRouter } from "./files";
import { healthRouter } from "./health";
import { os } from "./implementer";
import { invitationsRouter } from "./invitations";
import { jobsRouter } from "./jobs";
import { organizationsRouter } from "./organizations";
import { shopifyAppsRouter } from "./shopify-apps";
import { shopifyStoresRouter } from "./shopify-stores";

export const router = os.router({
  files: filesRouter,
  health: healthRouter,
  invitations: invitationsRouter,
  jobs: jobsRouter,
  organizations: organizationsRouter,
  shopifyApps: shopifyAppsRouter,
  shopifyStores: shopifyStoresRouter,
});
