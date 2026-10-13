export const PERMISSION_CATALOG = [
  { action: "read", label: "Read organization", module: "organization" },
  { action: "update", label: "Update organization", module: "organization" },
  { action: "read", label: "Read members", module: "members" },
  { action: "invite", label: "Invite members", module: "members" },
  { action: "manage", label: "Manage members", module: "members" },
  { action: "read", label: "Read roles", module: "roles" },
  { action: "manage", label: "Manage roles", module: "roles" },
  { action: "read", label: "Read audit log", module: "audit" },
  { action: "read", label: "View Shopify stores", module: "stores" },
  { action: "manage", label: "Manage Shopify stores", module: "stores" },
  { action: "query", label: "Run GraphQL queries", module: "graphql" },
  { action: "mutate", label: "Run GraphQL mutations", module: "graphql" },
] as const;
