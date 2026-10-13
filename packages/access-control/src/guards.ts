import { PERMISSION_CATALOG } from "./catalog";
import type { KnownPermission, PermissionInput, PermissionKey } from "./types";

export const formatPermissionKey = (permission: PermissionInput) =>
  `${permission.module}:${permission.action}`;

export const permissionKey = (permission: KnownPermission): PermissionKey =>
  formatPermissionKey(permission) as PermissionKey;

export const isKnownPermission = (
  permission: PermissionInput
): permission is KnownPermission =>
  PERMISSION_CATALOG.some(
    (candidate) =>
      candidate.module === permission.module &&
      candidate.action === permission.action
  );

export const normalizePermissions = (
  permissions: readonly PermissionInput[]
): KnownPermission[] => {
  const unique = new Map<PermissionKey, KnownPermission>();
  for (const permission of permissions) {
    if (isKnownPermission(permission)) {
      unique.set(permissionKey(permission), permission);
    }
  }
  return [...unique.values()];
};
