import { databaseBackupsRouter, databaseConnectionsRouter } from "./databases";
import { filesRouter } from "./files";
import { flowsRouter } from "./flows";
import { healthRouter } from "./health";
import { os } from "./implementer";
import { invitationsRouter } from "./invitations";
import { jobsRouter } from "./jobs";
import { organizationsRouter } from "./organizations";
import { savedQueriesRouter } from "./saved-queries";
import { shopifyAppsRouter } from "./shopify-apps";
import { shopifyGraphqlRouter } from "./shopify-graphql";
import { shopifyStoresRouter } from "./shopify-stores";

export const router = os.router({
  databaseBackups: databaseBackupsRouter,
  databaseConnections: databaseConnectionsRouter,
  files: filesRouter,
  flows: flowsRouter,
  health: healthRouter,
  invitations: invitationsRouter,
  jobs: jobsRouter,
  organizations: organizationsRouter,
  savedQueries: savedQueriesRouter,
  shopifyApps: shopifyAppsRouter,
  shopifyGraphql: shopifyGraphqlRouter,
  shopifyStores: shopifyStoresRouter,
});
