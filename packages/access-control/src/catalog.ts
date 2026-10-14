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
  { action: "read", label: "View flows and runs", module: "flows" },
  { action: "manage", label: "Create and edit flows", module: "flows" },
  // Running a flow changes store data through its action nodes, with the
  // full scopes of the store's token.
  { action: "run", label: "Run flows", module: "flows" },
  // Database connections reach production data, and their hosts and names
  // are sensitive, so even read access is withheld from the Viewer preset.
  { action: "read", label: "View database connections", module: "databases" },
  {
    action: "manage",
    label: "Manage database connections",
    module: "databases",
  },
  {
    action: "backup",
    label: "Run and download database backups",
    module: "databases",
  },
] as const;
