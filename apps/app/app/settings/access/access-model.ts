import {
  type KnownPermission,
  PERMISSION_CATALOG,
  permissionKey,
} from "@repo/access-control";

/** The permission grid: catalog permissions grouped by resource. */
export const PERMISSION_GROUPS = [
  {
    group: "Organization",
    icon: "organization",
    items: [
      { key: "organization:read", label: "Read organization" },
      { key: "organization:update", label: "Update organization" },
    ],
  },
  {
    group: "Members",
    icon: "members",
    items: [
      { key: "members:read", label: "Read members" },
      { key: "members:invite", label: "Invite members" },
      { key: "members:manage", label: "Manage members" },
    ],
  },
  {
    group: "Roles & audit",
    icon: "roles",
    items: [
      { key: "roles:read", label: "Read roles" },
      { key: "roles:manage", label: "Manage roles" },
      { key: "audit:read", label: "Read audit log" },
    ],
  },
  {
    group: "Shopify stores",
    icon: "stores",
    items: [
      { key: "stores:read", label: "View stores" },
      { key: "stores:manage", label: "Manage stores" },
    ],
  },
  {
    group: "GraphQL",
    icon: "graphql",
    items: [
      { key: "graphql:query", label: "Run queries" },
      { key: "graphql:mutate", label: "Run mutations" },
    ],
  },
  {
    group: "Flows",
    icon: "flows",
    items: [
      { key: "flows:read", label: "View flows and runs" },
      { key: "flows:manage", label: "Create and edit flows" },
      { key: "flows:run", label: "Run flows" },
    ],
  },
  {
    group: "Databases",
    icon: "databases",
    items: [
      { key: "databases:read", label: "View connections" },
      { key: "databases:manage", label: "Manage connections" },
      { key: "databases:backup", label: "Run and download backups" },
    ],
  },
] as const;

export type PermissionGroupIcon = (typeof PERMISSION_GROUPS)[number]["icon"];

/** Catalog permissions for a set of keys, in catalog order. */
export const permissionsFromKeys = (keys: ReadonlySet<string>) =>
  PERMISSION_CATALOG.filter((permission) =>
    keys.has(permissionKey(permission))
  ).map(({ action, module }) => ({ action, module }) as KnownPermission);

export interface BuiltInRole {
  description: string;
  hue: number;
  icon: "owner" | "admin" | "member" | "viewer";
}

/** The four roles every organization starts with; their permissions are fixed. */
export const BUILT_IN_ROLES: Record<string, BuiltInRole> = {
  Admin: {
    description: "Everything except deleting the organization.",
    hue: 265,
    icon: "admin",
  },
  Member: {
    description: "Day-to-day developer work: query stores and run flows.",
    hue: 160,
    icon: "member",
  },
  Owner: {
    description: "Full access, including billing-level organization changes.",
    hue: 60,
    icon: "owner",
  },
  Viewer: {
    description: "Read-only. Can’t open the GraphQL console.",
    hue: 230,
    icon: "viewer",
  },
};

const BUILT_IN_ORDER = ["Owner", "Admin", "Member", "Viewer"];

/** Built-in roles first, in rank order, then custom roles by name. */
export const sortRoles = <Role extends { name: string }>(roles: Role[]) =>
  [...roles].sort((a, b) => {
    const rankA = BUILT_IN_ORDER.indexOf(a.name);
    const rankB = BUILT_IN_ORDER.indexOf(b.name);
    if (rankA !== rankB) {
      return (
        (rankA === -1 ? BUILT_IN_ORDER.length : rankA) -
        (rankB === -1 ? BUILT_IN_ORDER.length : rankB)
      );
    }
    return a.name.localeCompare(b.name);
  });

export type AuditFilter = "all" | "stores" | "flows" | "database" | "members";

/** Each audit filter as the action prefixes it keeps. */
export const AUDIT_FILTERS: readonly {
  label: string;
  prefixes: string;
  value: AuditFilter;
}[] = [
  { label: "All", prefixes: "", value: "all" },
  { label: "Stores", prefixes: "shopify.", value: "stores" },
  { label: "Flows", prefixes: "flow.,flows.", value: "flows" },
  { label: "Database", prefixes: "database.", value: "database" },
  {
    label: "Members",
    prefixes: "member.,invitation.,role.,organization.",
    value: "members",
  },
];
