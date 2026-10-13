import { PERMISSION_CATALOG } from "./catalog";
import { permissionKey } from "./guards";
import type { KnownPermission, PermissionKey } from "./types";

const withoutLabels = (
  permissions: readonly (KnownPermission & { label?: string })[]
): KnownPermission[] =>
  permissions.map(
    ({ action, module }) => ({ action, module }) as KnownPermission
  );

export const OWNER_PERMISSIONS = withoutLabels(PERMISSION_CATALOG);

export const ADMIN_PERMISSIONS = [...OWNER_PERMISSIONS];

export const MEMBER_PERMISSIONS = [
  { action: "read", module: "organization" },
  { action: "read", module: "members" },
  { action: "read", module: "roles" },
] as const satisfies readonly KnownPermission[];

export const VIEWER_PERMISSIONS = withoutLabels(
  PERMISSION_CATALOG.filter(({ action }) => action === "read")
);

export const CUSTOM_ROLE_DEFAULT_PERMISSION_KEYS = [
  "organization:read",
  "members:read",
] as const satisfies readonly PermissionKey[];

export const ROLE_PERMISSION_PRESETS = {
  Admin: ADMIN_PERMISSIONS,
  Member: MEMBER_PERMISSIONS,
  Owner: OWNER_PERMISSIONS,
  Viewer: VIEWER_PERMISSIONS,
} as const;

export const permissionKeys = (permissions: readonly KnownPermission[]) =>
  permissions.map(permissionKey);
