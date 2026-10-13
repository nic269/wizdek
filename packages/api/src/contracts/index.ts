export { apiContract } from "./base";
export { filesContract } from "./files";
export { healthContract } from "./health";
export { invitationsContract } from "./invitations";
export { jobsContract } from "./jobs";
export { organizationsContract } from "./organizations";

import { filesContract } from "./files";
import { healthContract } from "./health";
import { invitationsContract } from "./invitations";
import { jobsContract } from "./jobs";
import { organizationsContract } from "./organizations";

export const contract = {
  files: filesContract,
  health: healthContract,
  invitations: invitationsContract,
  jobs: jobsContract,
  organizations: organizationsContract,
};
