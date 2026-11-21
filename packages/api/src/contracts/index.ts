export { apiContract } from "./base";
export {
  databaseBackupsContract,
  databaseConnectionsContract,
} from "./databases";
export { filesContract } from "./files";
export { flowsContract } from "./flows";
export {
  functionRunsContract,
  functionSchedulesContract,
  functionsContract,
} from "./functions";
export { healthContract } from "./health";
export { invitationsContract } from "./invitations";
export { jobsContract } from "./jobs";
export { organizationsContract } from "./organizations";
export { savedQueriesContract } from "./saved-queries";
export { shopifyAppsContract } from "./shopify-apps";
export { shopifyGraphqlContract } from "./shopify-graphql";
export { shopifyStoresContract } from "./shopify-stores";

import {
  databaseBackupsContract,
  databaseConnectionsContract,
} from "./databases";
import { filesContract } from "./files";
import { flowsContract } from "./flows";
import {
  functionRunsContract,
  functionSchedulesContract,
  functionsContract,
} from "./functions";
import { healthContract } from "./health";
import { invitationsContract } from "./invitations";
import { jobsContract } from "./jobs";
import { organizationsContract } from "./organizations";
import { savedQueriesContract } from "./saved-queries";
import { shopifyAppsContract } from "./shopify-apps";
import { shopifyGraphqlContract } from "./shopify-graphql";
import { shopifyStoresContract } from "./shopify-stores";

export const contract = {
  databaseBackups: databaseBackupsContract,
  databaseConnections: databaseConnectionsContract,
  files: filesContract,
  flows: flowsContract,
  functionRuns: functionRunsContract,
  functionSchedules: functionSchedulesContract,
  functions: functionsContract,
  health: healthContract,
  invitations: invitationsContract,
  jobs: jobsContract,
  organizations: organizationsContract,
  savedQueries: savedQueriesContract,
  shopifyApps: shopifyAppsContract,
  shopifyGraphql: shopifyGraphqlContract,
  shopifyStores: shopifyStoresContract,
};
